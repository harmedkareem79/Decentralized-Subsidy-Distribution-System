# 🌾 Decentralized Subsidy Distribution System

Welcome to a transparent and corruption-resistant way to distribute agricultural subsidies! This project uses the Stacks blockchain and Clarity smart contracts to verify farmer eligibility through on-chain farm data, ensuring fair distribution while reducing fraud and intermediaries.

## ✨ Features

🔍 On-chain verification of farm data for eligibility  
💰 Automated subsidy distribution via smart contracts  
📊 Immutable records of applications and payouts  
🛡️ Multi-signature governance to prevent tampering  
📈 Real-time auditing and transparency dashboards  
🚫 Anti-corruption mechanisms like data hashing and uniqueness checks  
✅ Integration with external oracles for real-world data validation  

## 🛠 How It Works

This system involves 8 smart contracts written in Clarity to handle registration, verification, distribution, and governance. Here's a breakdown:

### Core Smart Contracts
1. **FarmerRegistry.clar**: Registers farmers with unique IDs, storing basic info like wallet address and identity proofs.  
2. **FarmDataStorage.clar**: Securely stores hashed farm details (e.g., land size, crop types, yield history) to ensure immutability and privacy.  
3. **EligibilityCriteria.clar**: Defines and updates subsidy rules (e.g., minimum land size, crop requirements) via governance votes.  
4. **SubsidyApplication.clar**: Allows farmers to submit applications linking their registry ID to farm data hashes.  
5. **DataVerifier.clar**: Automates eligibility checks by comparing on-chain data against criteria, using oracles for external validation if needed.  
6. **TokenDistributor.clar**: Manages the subsidy token (e.g., a STX-based fungible token) and executes payouts to verified applicants.  
7. **GovernanceMultiSig.clar**: Handles proposals and votes for system updates, requiring multi-signature approval from stakeholders.  
8. **AuditLogger.clar**: Logs all transactions, applications, and distributions for public querying and transparency.

**For Farmers**  
- Register your identity in FarmerRegistry.clar.  
- Upload hashed farm data to FarmDataStorage.clar (e.g., generate a SHA-256 hash of your land deeds and crop reports).  
- Submit an application via SubsidyApplication.clar, referencing your data.  
- The DataVerifier.clar automatically checks eligibility against EligibilityCriteria.clar.  
- If approved, receive subsidies from TokenDistributor.clar directly to your wallet.  

Boom! No bribes or paperwork delays—everything is on-chain and verifiable.

**For Governments/Authorities**  
- Set initial criteria in EligibilityCriteria.clar.  
- Use GovernanceMultiSig.clar to propose and vote on updates (e.g., new subsidy amounts).  
- Monitor distributions and audits via AuditLogger.clar for compliance reporting.

**For Auditors/Verifiers**  
- Query AuditLogger.clar to view full transaction history.  
- Call functions in DataVerifier.clar to confirm any farmer's eligibility status.  
- Access public farm data hashes in FarmDataStorage.clar for independent verification.

That's it! This decentralized approach eliminates corruption by making all data and decisions transparent, immutable, and automated on the blockchain.