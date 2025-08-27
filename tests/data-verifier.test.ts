// tests/DataVerifier.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface VerificationResult {
  isEligible: boolean;
  checkedAt: number;
  score: number;
  reasons: string[];
  oracleValidated: boolean;
}

interface DetailedChecks {
  landSizeOk: boolean;
  cropTypeOk: boolean;
  yieldHistoryOk: boolean;
  ownershipProofOk: boolean;
  locationOk: boolean;
  additionalMetrics: { waterUsage: number; sustainabilityScore: number };
}

interface OracleResponse {
  response: Buffer;
  timestamp: number;
  verified: boolean;
}

interface GovernanceParams {
  paused: boolean;
  oracleAddress: string;
  minScore: number;
  lastUpdate: number;
}

interface ContractState {
  verificationResults: Map<string, VerificationResult>; // Key: `${farmer}-${appId}`
  detailedChecks: Map<string, DetailedChecks>; // Key: `${farmer}-${appId}`
  oracleResponses: Map<number, OracleResponse>;
  governanceParams: Map<string, GovernanceParams>;
  admin: string;
  requestCounter: number;
  paused: boolean;
  blockHeight: number; // Simulated block height
}

// Mock contract implementation
class DataVerifierMock {
  private state: ContractState = {
    verificationResults: new Map(),
    detailedChecks: new Map(),
    oracleResponses: new Map(),
    governanceParams: new Map(),
    admin: "deployer",
    requestCounter: 0,
    paused: false,
    blockHeight: 1000,
  };

  private MIN_LAND_SIZE = 100;
  private SCORE_THRESHOLD = 70;
  private VERIFICATION_EXPIRY = 144;
  private ERR_NOT_AUTHORIZED = 100;
  private ERR_INVALID_DATA = 101;
  private ERR_CRITERIA_NOT_MET = 102;
  private ERR_INVALID_FARMER = 103;
  private ERR_ALREADY_VERIFIED = 104;
  private ERR_ORACLE_FAILURE = 105;
  private ERR_INVALID_SCORE = 106;
  private ERR_NO_APPLICATION = 107;
  private ERR_EXPIRED_DATA = 108;
  private ERR_INVALID_CRITERIA = 109;
  private ERR_GOVERNANCE_LOCKED = 110;
  private ERR_INVALID_PARAMETER = 111;
  private ERR_MAX_REASONS_EXCEEDED = 112;
  private ERR_INVALID_HASH = 113;
  private ERR_PAUSED = 114;
  private ERR_NOT_PAUSED = 115;

  // Simulate block height increase
  private incrementBlockHeight(increment: number = 1) {
    this.state.blockHeight += increment;
  }

  getVerificationResult(farmer: string, applicationId: number): ClarityResponse<VerificationResult | null> {
    const key = `${farmer}-${applicationId}`;
    return { ok: true, value: this.state.verificationResults.get(key) ?? null };
  }

  getDetailedChecks(farmer: string, applicationId: number): ClarityResponse<DetailedChecks | null> {
    const key = `${farmer}-${applicationId}`;
    return { ok: true, value: this.state.detailedChecks.get(key) ?? null };
  }

  getOracleResponse(requestId: number): ClarityResponse<OracleResponse | null> {
    return { ok: true, value: this.state.oracleResponses.get(requestId) ?? null };
  }

  isEligible(farmer: string, applicationId: number): ClarityResponse<boolean> {
    const result = this.getVerificationResult(farmer, applicationId);
    if (result.ok && result.value) {
      return { ok: true, value: (result.value as VerificationResult).isEligible };
    }
    return { ok: true, value: false };
  }

  getScore(farmer: string, applicationId: number): ClarityResponse<number> {
    const result = this.getVerificationResult(farmer, applicationId);
    if (result.ok && result.value) {
      return { ok: true, value: (result.value as VerificationResult).score };
    }
    return { ok: true, value: 0 };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  getGovernanceParams(governor: string): ClarityResponse<GovernanceParams | null> {
    return { ok: true, value: this.state.governanceParams.get(governor) ?? null };
  }

  verifyEligibility(
    caller: string,
    farmer: string,
    applicationId: number,
    dataHash: Buffer,
    oracleRequest: boolean
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const key = `${farmer}-${applicationId}`;
    const existing = this.state.verificationResults.get(key);
    if (existing && this.state.blockHeight - existing.checkedAt < this.VERIFICATION_EXPIRY) {
      return { ok: false, value: this.ERR_ALREADY_VERIFIED };
    }

    // Simulate fetches
    const farmData = { landSize: 150, cropType: "wheat", yield: 500, ownershipHash: dataHash, location: "valid" };
    const landOk = farmData.landSize >= this.MIN_LAND_SIZE;
    const cropOk = ["wheat", "rice", "corn"].includes(farmData.cropType);
    const yieldOk = farmData.yield > 400;
    const ownershipOk = true; // Assume match
    const locationOk = farmData.location === "valid";

    const score = (landOk ? 20 : 0) + (cropOk ? 20 : 0) + (yieldOk ? 20 : 0) + (ownershipOk ? 20 : 0) + (locationOk ? 20 : 0);
    const eligible = score >= this.SCORE_THRESHOLD;
    const reasons: string[] = [];
    if (!landOk) reasons.push("Insufficient land size");
    if (!cropOk) reasons.push("Invalid crop type");
    if (!yieldOk) reasons.push("Low yield history");
    if (!ownershipOk) reasons.push("Invalid ownership proof");
    if (!locationOk) reasons.push("Invalid location");

    let oracleValidated = false;
    if (oracleRequest) {
      const reqId = ++this.state.requestCounter;
      this.state.oracleResponses.set(reqId, { response: Buffer.from("oracle-data"), timestamp: this.state.blockHeight, verified: true });
      oracleValidated = true;
    }

    this.state.verificationResults.set(key, {
      isEligible: eligible,
      checkedAt: this.state.blockHeight,
      score,
      reasons,
      oracleValidated,
    });

    this.state.detailedChecks.set(key, {
      landSizeOk: landOk,
      cropTypeOk: cropOk,
      yieldHistoryOk: yieldOk,
      ownershipProofOk: ownershipOk,
      locationOk: locationOk,
      additionalMetrics: { waterUsage: 100, sustainabilityScore: 85 },
    });

    this.incrementBlockHeight();
    return { ok: true, value: eligible };
  }

  pauseVerification(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseVerification(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  updateAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setGovernanceParams(
    caller: string,
    governor: string,
    newPaused: boolean,
    newOracle: string,
    newMinScore: number
  ): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    this.state.governanceParams.set(governor, {
      paused: newPaused,
      oracleAddress: newOracle,
      minScore: newMinScore,
      lastUpdate: this.state.blockHeight,
    });
    return { ok: true, value: true };
  }

  validateExternalOracle(
    requestId: number,
    response: Buffer,
    expectedHash: Buffer
  ): ClarityResponse<boolean> {
    const oracle = this.state.oracleResponses.get(requestId);
    if (!oracle) {
      return { ok: false, value: this.ERR_INVALID_PARAMETER };
    }
    // Simulate hash check
    const validated = true; // Assume passes
    if (validated) {
      this.state.oracleResponses.set(requestId, { ...oracle, verified: true });
      return { ok: true, value: true };
    }
    return { ok: false, value: this.ERR_ORACLE_FAILURE };
  }

  clearVerification(caller: string, farmer: string, applicationId: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_AUTHORIZED };
    }
    const key = `${farmer}-${applicationId}`;
    this.state.verificationResults.delete(key);
    this.state.detailedChecks.delete(key);
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  farmer1: "farmer_1",
  farmer2: "farmer_2",
  unauthorized: "unauthorized",
};

describe("DataVerifier Contract", () => {
  let contract: DataVerifierMock;

  beforeEach(() => {
    contract = new DataVerifierMock();
    vi.resetAllMocks();
  });

  it("should initialize with correct defaults", () => {
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
    expect(contract.getAdmin()).toEqual({ ok: true, value: "deployer" });
  });

  it("should verify eligibility successfully", () => {
    const dataHash = Buffer.from("hash");
    const result = contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    expect(result).toEqual({ ok: true, value: true });

    const verification = contract.getVerificationResult(accounts.farmer1, 1);
    expect(verification.ok).toBe(true);
    expect((verification.value as VerificationResult).isEligible).toBe(true);
    expect((verification.value as VerificationResult).score).toBe(100);
    expect((verification.value as VerificationResult).reasons).toHaveLength(0);
  });

  it("should prevent verification when paused", () => {
    contract.pauseVerification(accounts.deployer);
    const dataHash = Buffer.from("hash");
    const result = contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    expect(result).toEqual({ ok: false, value: 114 });
  });

  it("should handle oracle request", () => {
    const dataHash = Buffer.from("hash");
    const result = contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, true);
    expect(result).toEqual({ ok: true, value: true });

    const verification = contract.getVerificationResult(accounts.farmer1, 1);
    expect((verification.value as VerificationResult).oracleValidated).toBe(true);

    const oracle = contract.getOracleResponse(1);
    expect(oracle.ok).toBe(true);
    expect(oracle.value).toBeDefined();
  });

  it("should prevent non-admin from pausing", () => {
    const result = contract.pauseVerification(accounts.unauthorized);
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow admin to update admin", () => {
    const result = contract.updateAdmin(accounts.deployer, accounts.farmer1);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getAdmin()).toEqual({ ok: true, value: accounts.farmer1 });
  });

  it("should clear verification as admin", () => {
    const dataHash = Buffer.from("hash");
    contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    const clearResult = contract.clearVerification(accounts.deployer, accounts.farmer1, 1);
    expect(clearResult).toEqual({ ok: true, value: true });

    const verification = contract.getVerificationResult(accounts.farmer1, 1);
    expect(verification.value).toBeNull();
  });

  it("should validate external oracle", () => {
    // First create an oracle response
    const dataHash = Buffer.from("hash");
    contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, true);

    const validateResult = contract.validateExternalOracle(1, Buffer.from("oracle-data"), Buffer.from("expected"));
    expect(validateResult).toEqual({ ok: true, value: true });
  });

  it("should prevent verification if already verified and not expired", () => {
    const dataHash = Buffer.from("hash");
    contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    const secondResult = contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    expect(secondResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow re-verification after expiry", () => {
    const dataHash = Buffer.from("hash");
    contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    (contract as any).state.blockHeight += 200; // Simulate expiry
    const secondResult = contract.verifyEligibility(accounts.deployer, accounts.farmer1, 1, dataHash, false);
    expect(secondResult).toEqual({ ok: true, value: true });
  });
});