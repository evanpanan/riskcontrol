-- CreateTable
CREATE TABLE "QuoteHistoryCandle" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "candleTime" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteHistoryCandle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteHistoryCandle_symbol_interval_candleTime_key" ON "QuoteHistoryCandle"("symbol", "interval", "candleTime");

-- CreateIndex
CREATE INDEX "QuoteHistoryCandle_symbol_interval_candleTime_idx" ON "QuoteHistoryCandle"("symbol", "interval", "candleTime");

-- CreateIndex
CREATE INDEX "QuoteHistoryCandle_fetchedAt_idx" ON "QuoteHistoryCandle"("fetchedAt");
