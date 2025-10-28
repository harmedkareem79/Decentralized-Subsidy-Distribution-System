;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-STATE u101)
(define-constant ERR-ALREADY-APPLIED u102)
(define-constant ERR-INVALID-AMOUNT u103)
(define-constant ERR-NOT-REGISTERED u104)
(define-constant ERR-VERIFICATION-FAILED u105)
(define-constant ERR-SEASON-CLOSED u106)
(define-constant ERR-INVALID-SEASON u107)
(define-constant ERR-APPLICATION-LOCKED u108)
(define-constant ERR-DATA-MISMATCH u109)
(define-constant ERR-PAUSED u110)

;; Season parameters
(define-constant SEASON-DURATION u525600) ;; ~1 year in blocks (~10 min/block)
(define-constant APPLICATION-DEADLINE u432000) ;; ~3 months before season end

;; Application states
(define-constant STATE-PENDING "pending")
(define-constant STATE-SUBMITTED "submitted")
(define-constant STATE-VERIFIED "verified")
(define-constant STATE-REJECTED "rejected")
(define-constant STATE-APPROVED "approved")
(define-constant STATE-PAID "paid")

;; Data maps
(define-map Applications
  { farmer: principal, season-id: uint }
  {
    application-id: uint,
    data-hash: (buff 32),
    requested-amount: uint,
    state: (string-ascii 20),
    submitted-at: uint,
    verified-at: uint,
    notes: (string-utf8 500),
    verifier-score: uint
  }
)

(define-map SeasonConfig
  uint
  {
    start-block: uint,
    total-budget: uint,
    max-per-farmer: uint,
    is-active: bool,
    application-count: uint
  }
)

(define-map ApplicationCounter uint uint) ;; season-id -> next app id

;; Variables
(define-data-var admin principal tx-sender)
(define-data-var current-season uint u1)
(define-data-var paused bool false)

;; Read-only functions

(define-read-only (get-application (farmer principal) (season-id uint))
  (map-get? Applications { farmer: farmer, season-id: season-id })
)

(define-read-only (get-current-season)
  (var-get current-season)
)

(define-read-only (get-season-config (season-id uint))
  (map-get? SeasonConfig season-id)
)

(define-read-only (get-next-application-id (season-id uint))
  (default-to u1 (map-get? ApplicationCounter season-id))
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (can-apply (farmer principal) (season-id uint))
  (let (
    (season (map-get? SeasonConfig season-id))
    (application (map-get? Applications { farmer: farmer, season-id: season-id }))
  )
    (and
      (is-some season)
      (get is-active (unwrap-panic season))
      (is-none application)
      (> (+ block-height APPLICATION-DEADLINE) (get start-block (unwrap-panic season)))
    )
  )
)

;; Private functions

(define-private (generate-application-id (season-id uint))
  (let ((counter (get-next-application-id season-id)))
    (map-set ApplicationCounter season-id (+ counter u1))
    counter
  )
)

(define-private (validate-farmer-registration (farmer principal))
  ;; Mock: replace with contract-call to FarmerRegistry.is-registered
  (ok true)
)

(define-private (validate-data-hash (farmer principal) (data-hash (buff 32)))
  ;; Mock: replace with contract-call to FarmDataStorage.get-hash
  (ok true)
)

(define-private (trigger-verification (farmer principal) (application-id uint) (data-hash (buff 32)))
  ;; Mock: replace with contract-call to DataVerifier.verify-eligibility
  (ok true)
)

;; Public functions

(define-public (create-season (start-block uint) (total-budget uint) (max-per-farmer uint))
  (let ((season-id (+ (var-get current-season) u1)))
    (if (is-eq tx-sender (var-get admin))
      (begin
        (map-set SeasonConfig season-id
          { start-block: start-block, total-budget: total-budget, max-per-farmer: max-per-farmer, is-active: true, application-count: u0 })
        (var-set current-season season-id)
        (ok season-id)
      )
      (err ERR-NOT-AUTHORIZED)
    )
  )
)

(define-public (close-season (season-id uint))
  (let ((season (map-get? SeasonConfig season-id)))
    (if (and (is-some season) (is-eq tx-sender (var-get admin)))
      (begin
        (map-set SeasonConfig season-id
          (merge (unwrap-panic season) { is-active: false }))
        (ok true)
      )
      (err ERR-NOT-AUTHORIZED)
    )
  )
)

(define-public (submit-application (season-id uint) (data-hash (buff 32)) (requested-amount uint) (notes (string-utf8 500)))
  (if (var-get paused)
    (err ERR-PAUSED)
    (let (
      (season (unwrap! (map-get? SeasonConfig season-id) (err ERR-INVALID-SEASON)))
      (farmer tx-sender)
      (existing-app (map-get? Applications { farmer: farmer, season-id: season-id }))
    )
      (if (not (get is-active season))
        (err ERR-SEASON-CLOSED)
        (if (is-some existing-app)
          (err ERR-ALREADY-APPLIED)
          (if (> block-height (+ (get start-block season) APPLICATION-DEADLINE))
            (err ERR-SEASON-CLOSED)
            (if (> requested-amount (get max-per-farmer season))
              (err ERR-INVALID-AMOUNT)
              (let (
                (app-id (generate-application-id season-id))
                (reg-ok (unwrap! (validate-farmer-registration farmer) (err ERR-NOT-REGISTERED)))
                (hash-ok (unwrap! (validate-data-hash farmer data-hash) (err ERR-DATA-MISMATCH)))
              )
                (map-set Applications { farmer: farmer, season-id: season-id }
                  { application-id: app-id, data-hash: data-hash, requested-amount: requested-amount,
                    state: STATE-SUBMITTED, submitted-at: block-height, verified-at: u0, notes: notes, verifier-score: u0 })
                (map-set SeasonConfig season-id
                  (merge season { application-count: (+ (get application-count season) u1) }))
                ;; Trigger verification
                (match (trigger-verification farmer app-id data-hash)
                  success (ok app-id)
                  error (err ERR-VERIFICATION-FAILED)
                )
              )
            )
          )
        )
      )
    )
  )
)

(define-public (update-application-state (farmer principal) (season-id uint) (new-state (string-ascii 20)) (score uint))
  (let ((app (unwrap! (map-get? Applications { farmer: farmer, season-id: season-id }) (err ERR-INVALID-STATE))))
    (if (is-eq tx-sender (var-get admin))
      (begin
        (map-set Applications { farmer: farmer, season-id: season-id }
          (merge app { state: new-state, verifier-score: score, verified-at: block-height }))
        (ok true)
      )
      (err ERR-NOT-AUTHORIZED)
    )
  )
)

(define-public (pause-applications)
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set paused true) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (unpause-applications)
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set paused false) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (update-admin (new-admin principal))
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set admin new-admin) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)

;; Batch submission for testing
(define-public (batch-submit (entries (list 5 (tuple (farmer principal) (data-hash (buff 32)) (amount uint)))))
  (fold submit-batch-iter entries (ok (list)))
)

(define-private (submit-batch-iter (entry (tuple (farmer principal) (data-hash (buff 32)) (amount uint))) (prev (response (list uint) uint)))
  (match prev
    success (let ((result (submit-application (var-get current-season) (get data-hash entry) (get amount entry) "")))
              (match result
                app-id (ok (append success app-id))
                error prev))
    error prev
  )
)