;; DataVerifier.clar
;; Core verification contract for the Decentralized Subsidy Distribution System.
;; This contract handles automated eligibility checks for farmers applying for subsidies.
;; It cross-references on-chain farm data hashes with predefined criteria, supports oracle validation,
;; and logs verification results for transparency. It integrates with other contracts like
;; FarmerRegistry, FarmDataStorage, EligibilityCriteria, and SubsidyApplication.

;; Assumptions: This contract calls read-only functions from other contracts.
;; In a full deployment, replace 'contract-name with actual contract principals.

;; Constants for error codes
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-DATA u101)
(define-constant ERR-CRITERIA-NOT-MET u102)
(define-constant ERR-INVALID-FARMER u103)
(define-constant ERR-ALREADY-VERIFIED u104)
(define-constant ERR-ORACLE-FAILURE u105)
(define-constant ERR-INVALID-SCORE u106)
(define-constant ERR-NO-APPLICATION u107)
(define-constant ERR-EXPIRED-DATA u108)
(define-constant ERR-INVALID-CRITERIA u109)
(define-constant ERR-GOVERNANCE-LOCKED u110)
(define-constant ERR-INVALID-PARAMETER u111)
(define-constant ERR-MAX-REASONS-EXCEEDED u112)
(define-constant ERR-INVALID-HASH u113)
(define-constant ERR-PAUSED u114)
(define-constant ERR-NOT-PAUSED u115)

;; Constants for system parameters
(define-constant MIN_LAND_SIZE u100) ;; Minimum land size in sqm for eligibility example
(define-constant MAX_REASONS 5) ;; Max reasons for failure
(define-constant VERIFICATION_EXPIRY u144) ;; 144 blocks ~1 day expiry for verification cache
(define-constant SCORE_THRESHOLD u70) ;; Minimum score out of 100 for eligibility

;; Data maps
(define-map VerificationResults
  { farmer: principal, application-id: uint }
  {
    is-eligible: bool,
    checked-at: uint,
    score: uint,
    reasons: (list 5 (string-ascii 100)),
    oracle-validated: bool
  }
)

(define-map DetailedChecks
  { farmer: principal, application-id: uint }
  {
    land-size-ok: bool,
    crop-type-ok: bool,
    yield-history-ok: bool,
    ownership-proof-ok: bool,
    location-ok: bool,
    additional-metrics: (tuple (water-usage uint) (sustainability-score uint))
  }
)

(define-map OracleResponses
  { request-id: uint }
  {
    response: (buff 64),
    timestamp: uint,
    verified: bool
  }
)

(define-map GovernanceParams
  principal ;; Admin or governance principal
  {
    paused: bool,
    oracle-address: principal,
    min-score: uint,
    last-update: uint
  }
)

;; Variables
(define-data-var admin principal tx-sender)
(define-data-var request-counter uint u0)
(define-data-var paused bool false)

;; Read-only functions

(define-read-only (get-verification-result (farmer principal) (application-id uint))
  (map-get? VerificationResults { farmer: farmer, application-id: application-id })
)

(define-read-only (get-detailed-checks (farmer principal) (application-id uint))
  (map-get? DetailedChecks { farmer: farmer, application-id: application-id })
)

(define-read-only (get-oracle-response (request-id uint))
  (map-get? OracleResponses { request-id: request-id })
)

(define-read-only (is-eligible (farmer principal) (application-id uint))
  (let ((result (get-verification-result farmer application-id)))
    (if (is-some result)
      (get is-eligible (unwrap-panic result))
      false
    )
  )
)

(define-read-only (get-score (farmer principal) (application-id uint))
  (let ((result (get-verification-result farmer application-id)))
    (if (is-some result)
      (get score (unwrap-panic result))
      u0
    )
  )
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-governance-params (governor principal))
  (map-get? GovernanceParams governor)
)

;; Private functions

(define-private (check-land-size (land-size uint))
  (if (>= land-size MIN_LAND_SIZE)
    (ok true)
    (err ERR-CRITERIA-NOT-MET)
  )
)

(define-private (check-crop-type (crop-type (string-ascii 50)))
  (if (or (is-eq crop-type "wheat") (is-eq crop-type "rice") (is-eq crop-type "corn"))
    (ok true)
    (err ERR-CRITERIA-NOT-MET)
  )
)

(define-private (calculate-score (checks (tuple (land bool) (crop bool) (yield bool) (ownership bool) (location bool))))
  (+
    (if (get land checks) u20 u0)
    (if (get crop checks) u20 u0)
    (if (get yield checks) u20 u0)
    (if (get ownership checks) u20 u0)
    (if (get location checks) u20 u0)
  )
)

(define-private (validate-oracle-response (response (buff 64)) (expected (buff 32)))
  (is-eq (sha256 response) expected)
)

(define-private (fetch-farm-data (farmer principal))
  ;; Mock or contract-call to FarmDataStorage
  ;; For simulation: return sample data
  (ok (tuple (land-size u150) (crop-type "wheat") (yield u500) (ownership-hash (sha256 "proof")) (location "valid")))
)

(define-private (fetch-application (farmer principal) (application-id uint))
  ;; Mock or contract-call to SubsidyApplication
  (ok true) ;; Assume exists
)

(define-private (fetch-criteria)
  ;; Mock or contract-call to EligibilityCriteria
  (ok (tuple (min-land u100) (allowed-crops (list "wheat" "rice" "corn"))))
)

;; Public functions

(define-public (verify-eligibility (farmer principal) (application-id uint) (data-hash (buff 32)) (oracle-request bool))
  (if (var-get paused)
    (err ERR-PAUSED)
    (let
      (
        (existing (get-verification-result farmer application-id))
        (app-exists (unwrap! (fetch-application farmer application-id) (err ERR-NO-APPLICATION)))
        (farm-data (unwrap! (fetch-farm-data farmer) (err ERR-INVALID-DATA)))
        (criteria (unwrap! (fetch-criteria) (err ERR-INVALID-CRITERIA)))
        (land-ok (is-ok (check-land-size (get land-size farm-data))))
        (crop-ok (is-ok (check-crop-type (get crop-type farm-data))))
        (yield-ok (> (get yield farm-data) u400)) ;; Example check
        (ownership-ok (is-eq (get ownership-hash farm-data) data-hash))
        (location-ok (is-eq (get location farm-data) "valid"))
        (checks (tuple (land land-ok) (crop crop-ok) (yield yield-ok) (ownership ownership-ok) (location location-ok)))
        (score (calculate-score checks))
        (eligible (>= score SCORE_THRESHOLD))
        (reasons (if (not land-ok) (list "Insufficient land size") (list)))
        (reasons2 (if (not crop-ok) (append reasons "Invalid crop type") reasons))
        (reasons3 (if (not yield-ok) (append reasons2 "Low yield history") reasons2))
        (reasons4 (if (not ownership-ok) (append reasons3 "Invalid ownership proof") reasons3))
        (reasons5 (if (not location-ok) (append reasons4 "Invalid location") reasons4))
        (oracle-validated (if oracle-request
                            (let ((req-id (var-get request-counter)))
                              (var-set request-counter (+ req-id u1))
                              ;; Simulate oracle call
                              (map-set OracleResponses {request-id: req-id} {response: (sha256 "oracle-data"), timestamp: block-height, verified: true})
                              true)
                            false))
      )
      (if (is-some existing)
        (if (> (- block-height (get checked-at (unwrap-panic existing))) VERIFICATION_EXPIRY)
          (begin
            (map-set VerificationResults {farmer: farmer, application-id: application-id}
              {is-eligible: eligible, checked-at: block-height, score: score, reasons: reasons5, oracle-validated: oracle-validated})
            (map-set DetailedChecks {farmer: farmer, application-id: application-id}
              {land-size-ok: land-ok, crop-type-ok: crop-ok, yield-history-ok: yield-ok, ownership-proof-ok: ownership-ok, location-ok: location-ok,
               additional-metrics: (tuple (water-usage u100) (sustainability-score u85))})
            (ok eligible)
          )
          (err ERR-ALREADY-VERIFIED)
        )
        (begin
          (map-set VerificationResults {farmer: farmer, application-id: application-id}
            {is-eligible: eligible, checked-at: block-height, score: score, reasons: reasons5, oracle-validated: oracle-validated})
          (map-set DetailedChecks {farmer: farmer, application-id: application-id}
            {land-size-ok: land-ok, crop-type-ok: crop-ok, yield-history-ok: yield-ok, ownership-proof-ok: ownership-ok, location-ok: location-ok,
             additional-metrics: (tuple (water-usage u100) (sustainability-score u85))})
          (ok eligible)
        )
      )
    )
  )
)

(define-public (pause-verification)
  (if (is-eq tx-sender (var-get admin))
    (begin
      (var-set paused true)
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (unpause-verification)
  (if (is-eq tx-sender (var-get admin))
    (begin
      (var-set paused false)
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (update-admin (new-admin principal))
  (if (is-eq tx-sender (var-get admin))
    (begin
      (var-set admin new-admin)
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (set-governance-params (governor principal) (new-paused bool) (new-oracle principal) (new-min-score uint))
  (if (is-eq tx-sender (var-get admin))
    (begin
      (map-set GovernanceParams governor
        {paused: new-paused, oracle-address: new-oracle, min-score: new-min-score, last-update: block-height})
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (validate-external-oracle (request-id uint) (response (buff 64)) (expected-hash (buff 32)))
  (let ((oracle (get-oracle-response request-id)))
    (if (is-some oracle)
      (if (validate-oracle-response response expected-hash)
        (begin
          (map-set OracleResponses {request-id: request-id}
            (merge (unwrap-panic oracle) {verified: true}))
          (ok true)
        )
        (err ERR-ORACLE-FAILURE)
      )
      (err ERR-INVALID-PARAMETER)
    )
  )
)

;; Additional robust functions for edge cases

(define-public (clear-verification (farmer principal) (application-id uint))
  (if (is-eq tx-sender (var-get admin))
    (begin
      (map-delete VerificationResults {farmer: farmer, application-id: application-id})
      (map-delete DetailedChecks {farmer: farmer, application-id: application-id})
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (batch-verify (farmers (list 10 principal)) (application-ids (list 10 uint)) (data-hashes (list 10 (buff 32))))
  (fold batch-verify-iter (zip farmers application-ids data-hashes) (ok true))
)

(define-private (batch-verify-iter (entry (tuple (farmer principal) (app-id uint) (hash (buff 32)))) (prev (response bool)))
  (match prev
    success (verify-eligibility (get farmer entry) (get app-id entry) (get hash entry) false)
    error prev
  )
)

(define-read-only (get-multiple-results (farmers (list 10 principal)) (application-ids (list 10 uint)))
  (map get-verification-result farmers application-ids)
)