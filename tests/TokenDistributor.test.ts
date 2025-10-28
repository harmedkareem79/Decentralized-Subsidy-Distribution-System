// tests/TokenDistributor.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ClarityResponse<T> {
  ok: boolean;
  value: T | number;
}

interface PayoutRecord {
  amount: number;
  paidAt: number;
  txId: Buffer;
  batchId: number | null;
}

interface SeasonBudget {
  totalAllocated: number;
  totalPaid: number;
  remaining: number;
}

interface BatchPayout {
  totalAmount: number;
  successCount: number;
  failedCount: number;
  executedAt: number;
  executor: string;
}

interface Application {
  state: string;
  requestedAmount: number;
}

interface ContractState {
  payoutRecords: Map<string, PayoutRecord>;
  seasonBudget: Map<number, SeasonBudget>;
  batchPayouts: Map<number, BatchPayout>;
  admin: string;
  payoutPaused: boolean;
  batchCounter: number;
  blockHeight: number;
  stxBalances: Map<string, number>;
}

const STATES = { APPROVED: "approved", PAID: "paid" };

class TokenDistributorMock {
  private state: ContractState = {
    payoutRecords: new Map(),
    seasonBudget: new Map(),
    batchPayouts: new Map(),
    admin: "deployer",
    payoutPaused: false,
    batchCounter: 0,
    blockHeight: 1000,
    stxBalances: new Map([["deployer", 1000000]]),
  };

  private ERR_NOT_AUTHORIZED = 100;
  private ERR_INSUFFICIENT_BUDGET = 101;
  private ERR_ALREADY_PAID = 103;
  private ERR_PAUSED = 105;

  private incrementBlockHeight(n: number = 1) {
    this.state.blockHeight += n;
  }

  private getStxBalance(account: string): number {
    return this.state.stxBalances.get(account) ?? 0;
  }

  private transferStx(from: string, to: string, amount: number): boolean {
    const fromBal = this.getStxBalance(from);
    if (fromBal < amount) return false;
    this.state.stxBalances.set(from, fromBal - amount);
    this.state.stxBalances.set(to, this.getStxBalance(to) + amount);
    return true;
  }

  getPayoutRecord(
    farmer: string,
    seasonId: number
  ): ClarityResponse<PayoutRecord | null> {
    return {
      ok: true,
      value: this.state.payoutRecords.get(`${farmer}-${seasonId}`) ?? null,
    };
  }

  getSeasonBudget(seasonId: number): ClarityResponse<SeasonBudget | null> {
    return { ok: true, value: this.state.seasonBudget.get(seasonId) ?? null };
  }

  isPayoutPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.payoutPaused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  // Mock external contract calls
  private mockApplication(
    farmer: string,
    seasonId: number
  ): Application | null {
    if (farmer === "farmer_1" && seasonId === 1) {
      return { state: STATES.APPROVED, requestedAmount: 40000 };
    }
    return null;
  }

  initializeSeasonBudget(
    caller: string,
    seasonId: number,
    totalBudget: number
  ): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.seasonBudget.set(seasonId, {
      totalAllocated: 0,
      totalPaid: 0,
      remaining: totalBudget,
    });
    return { ok: true, value: true };
  }

  executePayout(
    caller: string,
    farmer: string,
    seasonId: number,
    amount: number
  ): ClarityResponse<boolean> {
    if (this.state.payoutPaused) return { ok: false, value: this.ERR_PAUSED };
    const app = this.mockApplication(farmer, seasonId);
    if (!app || app.state !== STATES.APPROVED) return { ok: false, value: 102 };
    const key = `${farmer}-${seasonId}`;
    if (this.state.payoutRecords.has(key))
      return { ok: false, value: this.ERR_ALREADY_PAID };
    const budget = this.state.seasonBudget.get(seasonId);
    if (!budget || budget.remaining < amount)
      return { ok: false, value: this.ERR_INSUFFICIENT_BUDGET };
    if (amount > app.requestedAmount) return { ok: false, value: 106 };

    if (!this.transferStx(caller, farmer, amount))
      return { ok: false, value: 104 };

    this.state.seasonBudget.set(seasonId, {
      ...budget,
      totalPaid: budget.totalPaid + amount,
      remaining: budget.remaining - amount,
    });

    this.state.payoutRecords.set(key, {
      amount,
      paidAt: this.state.blockHeight,
      txId: Buffer.from(`tx-${this.state.blockHeight}`),
      batchId: null,
    });

    this.incrementBlockHeight();
    return { ok: true, value: true };
  }

  pausePayouts(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.payoutPaused = true;
    return { ok: true, value: true };
  }

  unpausePayouts(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.payoutPaused = false;
    return { ok: true, value: true };
  }

  updateAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }
}

const accounts = {
  deployer: "deployer",
  farmer1: "farmer_1",
  farmer2: "farmer_2",
  unauthorized: "unauthorized",
};

describe("TokenDistributor Contract", () => {
  let contract: TokenDistributorMock;

  beforeEach(() => {
    contract = new TokenDistributorMock();
    vi.resetAllMocks();
  });

  it("should initialize season budget", () => {
    const result = contract.initializeSeasonBudget(
      accounts.deployer,
      1,
      500000
    );
    expect(result).toEqual({ ok: true, value: true });
    const budget = contract.getSeasonBudget(1);
    expect(budget.value?.remaining).toBe(500000);
  });

  it("should execute payout to approved farmer", () => {
    contract.initializeSeasonBudget(accounts.deployer, 1, 500000);
    const result = contract.executePayout(
      accounts.deployer,
      accounts.farmer1,
      1,
      40000
    );
    expect(result).toEqual({ ok: true, value: true });

    const record = contract.getPayoutRecord(accounts.farmer1, 1);
    expect(record.value?.amount).toBe(40000);
    const budget = contract.getSeasonBudget(1);
    expect(budget.value?.remaining).toBe(460000);
  });

  it("should prevent payout if paused", () => {
    contract.initializeSeasonBudget(accounts.deployer, 1, 500000);
    contract.pausePayouts(accounts.deployer);
    const result = contract.executePayout(
      accounts.deployer,
      accounts.farmer1,
      1,
      40000
    );
    expect(result).toEqual({ ok: false, value: 105 });
  });

  it("should prevent double payout", () => {
    contract.initializeSeasonBudget(accounts.deployer, 1, 500000);
    contract.executePayout(accounts.deployer, accounts.farmer1, 1, 40000);
    const result = contract.executePayout(
      accounts.deployer,
      accounts.farmer1,
      1,
      40000
    );
    expect(result).toEqual({ ok: false, value: 103 });
  });

  it("should prevent payout exceeding budget", () => {
    contract.initializeSeasonBudget(accounts.deployer, 1, 30000);
    const result = contract.executePayout(
      accounts.deployer,
      accounts.farmer1,
      1,
      40000
    );
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should allow admin to change", () => {
    contract.updateAdmin(accounts.deployer, accounts.farmer1);
    expect(contract.getAdmin()).toEqual({ ok: true, value: accounts.farmer1 });
  });
});
