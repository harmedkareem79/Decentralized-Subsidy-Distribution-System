// tests/SubsidyApplication.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ClarityResponse<T> {
  ok: boolean;
  value: T | number;
}

interface Application {
  applicationId: number;
  dataHash: Buffer;
  requestedAmount: number;
  state: string;
  submittedAt: number;
  verifiedAt: number;
  notes: string;
  verifierScore: number;
}

interface SeasonConfig {
  startBlock: number;
  totalBudget: number;
  maxPerFarmer: number;
  isActive: boolean;
  applicationCount: number;
}

interface ContractState {
  applications: Map<string, Application>; // key: `${farmer}-${seasonId}`
  seasonConfig: Map<number, SeasonConfig>;
  applicationCounter: Map<number, number>;
  admin: string;
  currentSeason: number;
  paused: boolean;
  blockHeight: number;
}

const STATES = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  VERIFIED: "verified",
  REJECTED: "rejected",
  APPROVED: "approved",
  PAID: "paid",
};

class SubsidyApplicationMock {
  private state: ContractState = {
    applications: new Map(),
    seasonConfig: new Map(),
    applicationCounter: new Map(),
    admin: "deployer",
    currentSeason: 0,
    paused: false,
    blockHeight: 1000,
  };

  private SEASON_DURATION = 525600;
  private APPLICATION_DEADLINE = 432000;
  private ERR_NOT_AUTHORIZED = 100;
  private ERR_ALREADY_APPLIED = 102;
  private ERR_INVALID_AMOUNT = 103;
  private ERR_SEASON_CLOSED = 106;
  private ERR_PAUSED = 110;

  private incrementBlockHeight(n: number = 1) {
    this.state.blockHeight += n;
  }

  getApplication(
    farmer: string,
    seasonId: number
  ): ClarityResponse<Application | null> {
    return {
      ok: true,
      value: this.state.applications.get(`${farmer}-${seasonId}`) ?? null,
    };
  }

  getCurrentSeason(): ClarityResponse<number> {
    return { ok: true, value: this.state.currentSeason };
  }

  getSeasonConfig(seasonId: number): ClarityResponse<SeasonConfig | null> {
    return { ok: true, value: this.state.seasonConfig.get(seasonId) ?? null };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  createSeason(
    caller: string,
    startBlock: number,
    totalBudget: number,
    maxPerFarmer: number
  ): ClarityResponse<number> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    const seasonId = this.state.currentSeason + 1;
    this.state.seasonConfig.set(seasonId, {
      startBlock,
      totalBudget,
      maxPerFarmer,
      isActive: true,
      applicationCount: 0,
    });
    this.state.currentSeason = seasonId;
    this.incrementBlockHeight();
    return { ok: true, value: seasonId };
  }

  closeSeason(caller: string, seasonId: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    const season = this.state.seasonConfig.get(seasonId);
    if (!season) return { ok: false, value: 107 };
    this.state.seasonConfig.set(seasonId, { ...season, isActive: false });
    return { ok: true, value: true };
  }

  submitApplication(
    caller: string,
    seasonId: number,
    dataHash: Buffer,
    requestedAmount: number,
    notes: string
  ): ClarityResponse<number> {
    if (this.state.paused) return { ok: false, value: this.ERR_PAUSED };
    const season = this.state.seasonConfig.get(seasonId);
    if (!season || !season.isActive)
      return { ok: false, value: this.ERR_SEASON_CLOSED };
    if (
      this.state.blockHeight >
      season.startBlock + this.APPLICATION_DEADLINE
    ) {
      return { ok: false, value: this.ERR_SEASON_CLOSED };
    }
    const key = `${caller}-${seasonId}`;
    if (this.state.applications.has(key))
      return { ok: false, value: this.ERR_ALREADY_APPLIED };
    if (requestedAmount > season.maxPerFarmer)
      return { ok: false, value: this.ERR_INVALID_AMOUNT };

    const counter = (this.state.applicationCounter.get(seasonId) ?? 0) + 1;
    this.state.applicationCounter.set(seasonId, counter);

    this.state.applications.set(key, {
      applicationId: counter,
      dataHash,
      requestedAmount,
      state: STATES.SUBMITTED,
      submittedAt: this.state.blockHeight,
      verifiedAt: 0,
      notes,
      verifierScore: 0,
    });

    this.state.seasonConfig.set(seasonId, {
      ...season,
      applicationCount: season.applicationCount + 1,
    });

    this.incrementBlockHeight();
    return { ok: true, value: counter };
  }

  updateApplicationState(
    caller: string,
    farmer: string,
    seasonId: number,
    newState: string,
    score: number
  ): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    const key = `${farmer}-${seasonId}`;
    const app = this.state.applications.get(key);
    if (!app) return { ok: false, value: 101 };
    this.state.applications.set(key, {
      ...app,
      state: newState,
      verifierScore: score,
      verifiedAt: this.state.blockHeight,
    });
    return { ok: true, value: true };
  }

  pauseApplications(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseApplications(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin)
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    this.state.paused = false;
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

describe("SubsidyApplication Contract", () => {
  let contract: SubsidyApplicationMock;

  beforeEach(() => {
    contract = new SubsidyApplicationMock();
    vi.resetAllMocks();
  });

  it("should create a new season", () => {
    const result = contract.createSeason(
      accounts.deployer,
      1000,
      1000000,
      50000
    );
    expect(result).toEqual({ ok: true, value: 1 });
    expect(contract.getCurrentSeason()).toEqual({ ok: true, value: 1 });
  });

  it("should allow farmer to submit application", () => {
    contract.createSeason(accounts.deployer, 1000, 1000000, 50000);
    const dataHash = Buffer.from("valid-hash");
    const result = contract.submitApplication(
      accounts.farmer1,
      1,
      dataHash,
      40000,
      "Good farm"
    );
    expect(result).toEqual({ ok: true, value: 1 });

    const app = contract.getApplication(accounts.farmer1, 1);
    expect(app.value?.state).toBe("submitted");
    expect(app.value?.requestedAmount).toBe(40000);
  });

  it("should prevent double application", () => {
    contract.createSeason(accounts.deployer, 1000, 1000000, 50000);
    const dataHash = Buffer.from("hash");
    contract.submitApplication(accounts.farmer1, 1, dataHash, 40000, "");
    const result = contract.submitApplication(
      accounts.farmer1,
      1,
      dataHash,
      40000,
      ""
    );
    expect(result).toEqual({ ok: false, value: 102 });
  });

  it("should reject application after deadline", () => {
    contract.createSeason(accounts.deployer, 1000, 1000000, 50000);
    // Advance past deadline
    for (let i = 0; i < 440000; i++) contract["incrementBlockHeight"]();
    const dataHash = Buffer.from("hash");
    const result = contract.submitApplication(
      accounts.farmer1,
      1,
      dataHash,
      40000,
      ""
    );
    expect(result).toEqual({ ok: false, value: 106 });
  });

  it("should allow admin to update application state", () => {
    contract.createSeason(accounts.deployer, 1000, 1000000, 50000);
    const dataHash = Buffer.from("hash");
    contract.submitApplication(accounts.farmer1, 1, dataHash, 40000, "");
    const result = contract.updateApplicationState(
      accounts.deployer,
      accounts.farmer1,
      1,
      "approved",
      85
    );
    expect(result).toEqual({ ok: true, value: true });

    const app = contract.getApplication(accounts.farmer1, 1);
    expect(app.value?.state).toBe("approved");
    expect(app.value?.verifierScore).toBe(85);
  });

  it("should pause and prevent submissions", () => {
    contract.createSeason(accounts.deployer, 1000, 1000000, 50000);
    contract.pauseApplications(accounts.deployer);
    const dataHash = Buffer.from("hash");
    const result = contract.submitApplication(
      accounts.farmer1,
      1,
      dataHash,
      40000,
      ""
    );
    expect(result).toEqual({ ok: false, value: 110 });
  });
});
