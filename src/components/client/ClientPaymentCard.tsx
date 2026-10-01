'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { markShipmentPaid } from '@/app/actions/client';
import { inr, km } from '@/lib/format';
import { ActionButton } from '../ActionButton';
import { Icon } from '../Icon';

/** Name shown to the payer in their UPI app. */
const PAYEE_NAME = 'LogicLanes';

type Props = {
  shipmentId: string;
  reference: string;
  status: 'assigned' | 'in_transit' | 'delivered';
  distanceKm: number;
  cargoType: string;
  priceInr: number;
  /** When the client marked it paid, formatted for display. Null while unpaid. */
  paidOn: string | null;
  /** The UPI id (VPA) payments go to, from the UPI_ID environment variable. Null when it is not set. */
  upiId: string | null;
};

/**
 * Standard UPI deep link: any UPI app that scans it (or opens it on a phone)
 * shows the payee, the exact amount and the shipment reference, ready to pay.
 */
function upiLink(upiId: string, amountInr: number, reference: string): string {
  // The id keeps its "@" unescaped: several UPI apps do not accept it percent-encoded.
  return `upi://pay?pa=${upiId}&pn=${encodeURIComponent(PAYEE_NAME)}&am=${amountInr.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Freight ${reference}`)}`;
}

/**
 * Payment panel docked at the bottom of a shipment.
 *
 * - While the job is assigned or on the road: trip brief + "pay after delivery" notice. No QR is generated.
 * - Once delivered: the notice gives way to a UPI QR for the exact freight, and a "Mark as Paid" button.
 * - Once marked paid: a receipt line.
 */
export function ClientPaymentCard({ shipmentId, reference, status, distanceKm, cargoType, priceInr, paidOn, upiId }: Props) {
  const reduce = useReducedMotion();
  const delivered = status === 'delivered';
  const state = paidOn ? 'paid' : delivered ? 'due' : 'locked';
  const validUpi = upiId && /^[\w.-]{2,}@[a-zA-Z][\w.-]{1,}$/.test(upiId) ? upiId : null;

  return (
    <section aria-label={`Payment for ${reference}`} className="mt-6 rounded-2xl border border-noir/10 bg-white/40 p-5 sm:p-6">
      <h4 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-midnight">
        <Icon name="wallet" size={18} />
        Payment
      </h4>

      {/* Trip brief */}
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl border border-noir/10 bg-white/40 px-2 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Distance</dt>
          <dd className="mt-0.5 text-lg font-black leading-tight">{km(distanceKm)}</dd>
        </div>
        <div className="rounded-2xl border border-noir/10 bg-white/40 px-2 py-3">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-noir/60">Cargo</dt>
          <dd className="mt-0.5 text-lg font-black leading-tight">{cargoType}</dd>
        </div>
        <div className="rounded-2xl bg-midnight px-2 py-3 text-pearl">
          <dt className="text-xs font-extrabold uppercase tracking-wide text-pearl/75">Freight</dt>
          <dd className="mt-0.5 text-lg font-black leading-tight tabular-nums">{inr(priceInr)}</dd>
        </div>
      </dl>

      {/* Keyed by state: when the status changes the new block fades in, a crossfade from notice to QR. */}
      <motion.div key={state} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className="mt-4">
        {state === 'locked' ? (
          <p className="flex items-center gap-3 rounded-2xl bg-noir px-4 py-4 font-extrabold text-pearl">
            <Icon name="lock" size={22} className="shrink-0" />
            Payment will unlock after the job is successfully delivered.
          </p>
        ) : null}

        {state === 'due' ? (
          validUpi ? (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              {/* A QR must be dark on solid white with a clear margin to scan reliably, so this tile is not glass. */}
              <div className="shrink-0 rounded-2xl bg-white p-4 shadow-card-accent">
                <QRCodeSVG
                  value={upiLink(validUpi, priceInr, reference)}
                  size={184}
                  level="M"
                  marginSize={1}
                  fgColor="#000000"
                  bgColor="#FFFFFF"
                  title={`UPI QR code to pay ${inr(priceInr)} for ${reference}`}
                />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-xl font-black leading-tight">
                  Scan to pay <span className="tabular-nums">{inr(priceInr)}</span>
                </p>
                <p className="mt-1 break-all font-bold text-noir/70">UPI: {validUpi}</p>
                <div className="mt-4 flex flex-col gap-3">
                  <ActionButton
                    action={markShipmentPaid.bind(null, shipmentId)}
                    className="btn-primary w-full"
                    confirmText={`Confirm that you have paid ${inr(priceInr)} for ${reference}?`}
                  >
                    <Icon name="check" size={20} />
                    Mark as Paid
                  </ActionButton>
                  {/* On a phone this opens the UPI app directly with the amount filled in. */}
                  <a href={upiLink(validUpi, priceInr, reference)} className="btn-secondary w-full sm:hidden">
                    Pay in a UPI app
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-noir/30 p-4 font-bold">
              Delivered. Payment is not set up yet: add <code className="font-black">UPI_ID</code> to the environment to show the QR code.
            </p>
          )
        ) : null}

        {state === 'paid' ? (
          <p className="flex items-center gap-3 rounded-2xl bg-midnight px-4 py-4 font-extrabold text-pearl">
            <Icon name="check" size={22} className="shrink-0" />
            Marked as paid on {paidOn}
          </p>
        ) : null}
      </motion.div>
    </section>
  );
}
