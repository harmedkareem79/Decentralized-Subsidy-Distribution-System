;; TokenDistributor.clar
;; Core contract for secure, automated subsidy payouts.
;; Distributes STX or fungible tokens to verified farmers based on SubsidyApplication state.
;; Supports batch payouts, clawbacks, budget caps, and multi-admin governance.

;; Constants
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BUDGET u101)
(define-constant ERR-INVALID-STATE u102)
(define-constant ERR-ALREADY-PAID u103)
(define-constant ERR-TRANSFER-FAILED u104)
(define-constant ERR-PAUSED u105)
(define-constant ERR-INVALID-AMOUNT u106)
(define-constant ERR-SEASON-CLOSED u107)
(define-constant ERR-BATCH-FAILED u108)

;; Payout states
(define-constant STATE-APPROVED "approved")
(define-constant STATE-PAID "paid")

;; Data maps
(define-map PayoutRecords
  { farmer: principal, season-id: uint }
  {
    amount: uint,
    paid-at: uint,
    tx-id: (buff 32),
    batch-id: (optional uint)
  }
)

(define-map SeasonBudget
  uint
  {
    total-allocated: uint,
    total-paid: uint,
    remaining: uint
  }
)

(define-map BatchPayouts
  uint
  {
    total-amount: uint,
    success-count: uint,
    failed-count: uint,
    executed-at: uint,
    executor: principal
  }
)

;; Variables
(define-data-var admin principal tx-sender)
(define-data-var payout-paused bool false)
(define-data-var batch-counter uint u0)

;; Read-only functions
(define-read-only (get-payout-record (farmer principal) (season-id uint))
  (map-get? PayoutRecords { farmer: farmer, season-id: season-id })
)

(define-read-only (get-season-budget (season-id uint))
  (map-get? SeasonBudget season-id)
)

(define-read-only (get-batch-payout (batch-id uint))
  (map-get? BatchPayouts batch-id)
)

(define-read-only (is-payout-paused)
  (var-get payout-paused)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (can-payout (farmer principal) (season-id uint) (amount uint))
  (let (
    (payout (get-payout-record farmer season-id))
    (budget (get-season-budget season-id))
    (app (contract-call? .SubsidyApplication get-application farmer season-id))
  )
    (and
      (is-none payout)
      (is-some app)
      (is-eq (get state (unwrap-panic app)) STATE-APPROVED)
      (is-some budget)
      (>= (get remaining (unwrap-panic budget)) amount)
    )
  )
)

;; Private functions
(define-private (update-budget (season-id uint) (amount uint) (is-payout bool))
  (let ((budget (unwrap-panic (get-season-budget season-id))))
    (if is-payout
      (map-set SeasonBudget season-id
        (merge budget {
          total-paid: (+ (get total-paid budget) amount),
          remaining: (- (get remaining budget) amount)
        }))
      (map-set SeasonBudget season-id
        (merge budget {
          total-allocated: (+ (get total-allocated budget) amount),
          remaining: (- (get remaining budget) amount)
        }))
    )
    (ok true)
  )
)

(define-private (record-payout (farmer principal) (season-id uint) (amount uint) (tx-id (buff 32)) (batch-id (optional uint)))
  (map-set PayoutRecords { farmer: farmer, season-id: season-id }
    { amount: amount, paid-at: block-height, tx-id: tx-id, batch-id: batch-id })
)

;; Public functions

(define-public (initialize-season-budget (season-id uint) (total-budget uint))
  (if (is-eq tx-sender (var-get admin))
    (begin
      (map-set SeasonBudget season-id
        { total-allocated: u0, total-paid: u0, remaining: total-budget })
      (ok true)
    )
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (execute-payout (farmer principal) (season-id uint) (amount uint))
  (if (var-get payout-paused)
    (err ERR-PAUSED)
    (let (
      (app (unwrap! (contract-call? .SubsidyApplication get-application farmer season-id) (err ERR-INVALID-STATE)))
      (payout (get-payout-record farmer season-id))
      (budget (unwrap! (get-season-budget season-id) (err ERR-INVALID-STATE)))
    )
      (if (not (is-eq (get state app) STATE-APPROVED))
        (err ERR-INVALID-STATE)
        (if (is-some payout)
          (err ERR-ALREADY-PAID)
          (if (< (get remaining budget) amount)
            (err ERR-INSUFFICIENT-BUDGET)
            (if (> amount (get requested-amount app))
              (err ERR-INVALID-AMOUNT)
              (begin
                (try! (stx-transfer? amount tx-sender farmer))
                (try! (update-budget season-id amount true))
                (record-payout farmer season-id amount (get-txid) none)
                (try! (contract-call? .SubsidyApplication update-application-state farmer season-id STATE-PAID u0))
                (ok true)
              )
            )
          )
        )
      )
    )
  )
)

(define-public (batch-payout (entries (list 10 (tuple (farmer principal) (season-id uint) (amount uint)))))
  (if (var-get payout-paused)
    (err ERR-PAUSED)
    (let (
      (batch-id (+ (var-get batch-counter) u1))
      (results (fold payout-iter entries { success: u0, failed: u0, total: u0, records: (list) }))
    )
      (var-set batch-counter batch-id)
      (map-set BatchPayouts batch-id
        { total-amount: (get total results), success-count: (get success results),
          failed-count: (get failed results), executed-at: block-height, executor: tx-sender })
      (ok batch-id)
    )
  )
)

(define-private (payout-iter
  (entry (tuple (farmer principal) (season-id uint) (amount uint)))
  (acc (tuple (success uint) (failed uint) (total uint) (records (list 10 (response bool uint))))))
  (let ((result (execute-payout (get farmer entry) (get season-id entry) (get amount entry))))
    (match result
      success (tuple
        (+ (get success acc) u1)
        (get failed acc)
        (+ (get total acc) (get amount entry))
        (append (get records acc) (ok true)))
      error (tuple
        (get success acc)
        (+ (get failed acc) u1)
        (get total acc)
        (append (get records acc) (err (get error result))))
    )
  )
)

(define-public (clawback (farmer principal) (season-id uint))
  (let (
    (payout (unwrap! (get-payout-record farmer season-id) (err ERR-INVALID-STATE)))
    (app (unwrap! (contract-call? .SubsidyApplication get-application farmer season-id) (err ERR-INVALID-STATE)))
  )
    (if (is-eq tx-sender (var-get admin))
      (begin
        (try! (stx-transfer? (get amount payout) farmer tx-sender))
        (try! (update-budget season-id (get amount payout) false))
        (map-delete PayoutRecords { farmer: farmer, season-id: season-id })
        (try! (contract-call? .SubsidyApplication update-application-state farmer season-id STATE-APPROVED u0))
        (ok true)
      )
      (err ERR-NOT-AUTHORIZED)
    )
  )
)

(define-public (pause-payouts)
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set payout-paused true) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (unpause-payouts)
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set payout-paused false) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)

(define-public (update-admin (new-admin principal))
  (if (is-eq tx-sender (var-get admin))
    (begin (var-set admin new-admin) (ok true))
    (err ERR-NOT-AUTHORIZED)
  )
)