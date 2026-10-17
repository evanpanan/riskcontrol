-- Phase 4: 客户多批次子账户
-- Client 表新增中阳证券子账号编号（客户×批次唯一）

ALTER TABLE "Client" ADD COLUMN "subAccountNo" TEXT;
CREATE UNIQUE INDEX "Client_subAccountNo_key" ON "Client"("subAccountNo");
