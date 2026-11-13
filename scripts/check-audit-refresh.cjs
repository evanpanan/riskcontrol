const fs = require("fs"),
  ts = require(process.cwd() + "/node_modules/typescript"),
  assert = require("node:assert/strict");
function harness(file, mocks) {
  let slots = [],
    index = 0,
    effects = [];
  const React = {
    useState(v) {
      const i = index++;
      if (!(i in slots)) slots[i] = v;
      return [
        slots[i],
        (v) => {
          slots[i] = typeof v === "function" ? v(slots[i]) : v;
        },
      ];
    },
    useRef(v) {
      const i = index++;
      return slots[i] ?? (slots[i] = { current: v });
    },
    useMemo(fn) {
      index++;
      return fn();
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || deps.some((v, n) => v !== slots[i][n])) {
        slots[i] = deps;
        effects.push(fn);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  new Function("require", "module", "exports", code)(
    (name) =>
      name === "react"
        ? React
        : name === "react/jsx-runtime"
          ? { jsx, jsxs: jsx }
          : mocks[name] || new Proxy({}, { get: (_, key) => key }),
    mod,
    mod.exports,
  );
  return {
    render(props) {
      index = 0;
      const tree = (mod.exports.default || mod.exports.RoleGate)(props);
      const run = effects;
      effects = [];
      run.forEach((f) => f());
      return tree;
    },
  };
}
let fetches = 0,
  resolve,
  listener;
const row = {
  id: "1",
  action: "page_view",
  createdAt: new Date().toISOString(),
};
global.window = {
  addEventListener: (name, fn) => (listener = fn),
  removeEventListener() {},
};
global.fetch = () => {
  fetches++;
  return new Promise((done) => {
    resolve = (logs) => done({ ok: true, json: () => ({ logs, canDelete: false }) });
  });
};
const app = harness("src/app/operation-records/page.tsx", {
  "@/types/auth": {
    APP_ROLES: { ADMIN: "ADMIN", RISK_MANAGER: "RISK_MANAGER" },
    ROLE_LABELS: {},
  },
  "@/lib/auth/auditDisplay": {
    AUDIT_ACTION_FILTER_OPTIONS: [],
    describeAuditLog: () => "",
    getAuditActionLabel: () => "",
    getAuditResourceLabel: () => "",
  },
  "@/lib/utils": { cn: () => "", formatDateTime: () => "" },
  sonner: { toast: { error() {} } },
});
function button(node) {
  if (!node || typeof node !== "object") return;
  if (node.props?.onClick && node.props.disabled !== undefined) return node;
  for (const c of [node.props?.children].flat(Infinity)) {
    const b = button(c);
    if (b) return b;
  }
}
(async () => {
  app.render();
  assert.equal(fetches, 1);
  resolve([row]);
  await Promise.resolve();
  await Promise.resolve();
  for (let i = 0; i < 20; i++) {
    listener();
    app.render();
  }
  assert.equal(fetches, 1, "audit events must not reload");
  const b = button(app.render());
  b.props.onClick();
  b.props.onClick();
  assert.equal(fetches, 2, "overlapping refresh must coalesce");
  resolve([row]);
  await Promise.resolve();
  let denied = 0;
  let role = "OPERATIONS";
  const gate = harness("src/components/auth/RoleGate.tsx", {
    "@/lib/auth/useCurrentUser": {
      useCurrentUser: () => ({ user: { id: "qa" }, role, isLoading: false }),
    },
    "@/lib/auth/audit": { logAuthDeny: () => denied++ },
  });
  for (let i = 0; i < 20; i++) gate.render({ allowed: ["ADMIN"] });
  assert.equal(denied, 1);
  role = "ADMIN";
  gate.render({ allowed: ["ADMIN"] });
  role = "OPERATIONS";
  gate.render({ allowed: ["ADMIN"] });
  assert.equal(denied, 2);
  console.log(
    "PASS: 20 audit events cause zero reloads; manual refresh is single-flight; repeated permission renders do not repeat audit writes",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
