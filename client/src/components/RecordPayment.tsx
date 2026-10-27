import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { peso } from '../lib/format';
import { Modal, Field, Select, Input, Button, ErrorBox, useToast } from './ui';

export function RecordPayment({ open, onClose, purpose, targetId, amountCents, label, onDone }: { open: boolean; onClose: () => void; purpose: string; targetId: string; amountCents: number; label: string; onDone?: () => void }) {
  const [method, setMethod] = useState('CASH'); const [ref, setRef] = useState(''); const toast = useToast(); const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.post('/payments', { purpose, targetId, method, externalRef: ref || undefined }),
    onSuccess: () => { toast(`Payment of ${peso(amountCents)} recorded`); qc.invalidateQueries(); onDone?.(); onClose(); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Record payment">
      <p className="text-navy-700">{label}</p>
      <p className="num mt-2 font-display text-4xl font-bold">{peso(amountCents)}</p>
      <p className="text-sm text-navy-600">The amount comes from the booking record and can’t be edited here.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="GCASH_MANUAL">GCash (manual check)</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD_TERMINAL">Card terminal</option></Select></Field>
        {method !== 'CASH' && <Field label="Transaction reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Required for non-cash" /></Field>}
      </div>
      {m.error && <div className="mt-3"><ErrorBox error={m.error} /></div>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={method !== 'CASH' && !ref} onClick={() => m.mutate()}>Record payment</Button></div>
    </Modal>
  );
}
