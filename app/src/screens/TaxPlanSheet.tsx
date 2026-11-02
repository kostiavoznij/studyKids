import { useState } from 'react';
import { useLivePayments, useLiveTaxes, useTaxPlan } from '../data/selectors';
import { useData } from '../data/store';
import {
  addMonth,
  changeOptions,
  EVERY,
  everyAt,
  isQuarter,
  monthOf,
  periodLabel,
  plannedRule,
  quarterOf,
  TAX_KINDS,
  taxLabel,
  thisMonth,
  withRule,
} from '../data/taxes';
import type { TaxEvery, TaxKind, TaxPayment, TaxPlan, TaxRule } from '../data/types';
import { cap } from '../lib/dates';
import { Segmented, Sheet } from '../ui/components';
import { useUi } from '../ui/uiStore';

const everyWord = (e: TaxEvery) => (e === 'quarter' ? 'щокварталу' : 'щомісяця');
const sinceWord = (r: TaxRule) => (r.from ? `з ${periodLabel(quarterOf(r.from), true)} — ${everyWord(r.every)}` : cap(everyWord(r.every)));

export function TaxPlanSheet({ onClose }: { onClose: () => void }) {
  const { plan, saved } = useTaxPlan();
  const saveTaxPlan = useData((s) => s.saveTaxPlan);
  const taxes = useLiveTaxes();
  const payments = useLivePayments();
  const notify = useUi((s) => s.notify);
  const today = thisMonth();

  const saveRules = (kind: TaxKind, rules: TaxRule[], message: string) => {
    saveTaxPlan({ start: plan.start, rules: { ...plan.rules, [kind]: rules } });
    notify(message);
  };

  let earliest = addMonth(today, -24);
  if (plan.start < earliest) earliest = plan.start;
  for (const p of payments) if (monthOf(p.date) < earliest) earliest = monthOf(p.date);
  const months: string[] = [];
  for (let m = today; m >= earliest; m = addMonth(m, -1)) months.push(m);

  return (
    <Sheet
      title="Як я сплачую податки"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary"
          onClick={() => {
            if (!saved) saveTaxPlan(plan);
            onClose();
          }}
        >
          {saved ? 'Готово' : 'Усе так, зберегти'}
        </button>
      }
    >
      <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
        Графік можна змінити лише з початку кварталу: так місяці й квартали не перекриваються, а вже внесені сплати лишаються як є.
      </p>

      {TAX_KINDS.map((k) => (
        <RuleBlock key={k.value} kind={k.value} plan={plan} taxes={taxes} onSave={(rules, msg) => saveRules(k.value, rules, msg)} />
      ))}

      <label className="field">
        <span className="field-label">Нагадувати про податки з</span>
        <select
          className="select"
          value={plan.start}
          onChange={(e) => {
            saveTaxPlan({ start: e.target.value, rules: plan.rules });
            notify(`Нагадування з: ${periodLabel(e.target.value, true)}`);
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {cap(periodLabel(m, true))}
            </option>
          ))}
        </select>
        <span className="field-hint">За місяці до цього застосунок не нагадує внести податок. Підсумки грошей від цього не залежать.</span>
      </label>
    </Sheet>
  );
}

function RuleBlock({
  kind,
  plan,
  taxes,
  onSave,
}: {
  kind: TaxKind;
  plan: TaxPlan;
  taxes: TaxPayment[];
  onSave: (rules: TaxRule[], message: string) => void;
}) {
  const today = thisMonth();
  const now = everyAt(plan, kind, today);
  const planned = plannedRule(plan, kind, today);
  const [target, setTarget] = useState<TaxEvery | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const info = TAX_KINDS.find((k) => k.value === kind)!;
  const rules = plan.rules[kind];

  const check = target ? changeOptions(plan, kind, target, taxes, today) : null;
  const chosen = check?.options.find((o) => o.from === from) ?? check?.options[0];

  const pick = (e: TaxEvery) => {
    setTarget(e === now ? null : e);
    setFrom(null);
  };

  const apply = () => {
    if (!target || !chosen) return;
    onSave(withRule(plan, kind, target, chosen.from), `${info.label}: ${everyWord(target)} ${chosen.label}`);
    setTarget(null);
  };

  const cancelPlanned = () => {
    if (planned) onSave(withRule(plan, kind, now, planned.from), `${info.label}: зміну скасовано, лишається ${everyWord(now)}`);
  };

  const blocked = check?.blockedBy;

  return (
    <div className="tax-rule">
      <div className="tax-rule-head">
        <b>{info.label}</b>
        <span>{info.long}</span>
      </div>
      <Segmented label={`Як часто сплачую: ${info.label}`} value={target ?? now} options={EVERY} onChange={pick} />

      {!target && (rules.length > 1 || planned) && (
        <p className="field-hint" style={{ marginTop: 8 }}>
          {rules.map(sinceWord).join(' → ')}
          {planned && (
            <>
              {' '}
              <button className="link-btn" onClick={cancelPlanned}>
                Скасувати зміну з {periodLabel(quarterOf(planned.from), true)}
              </button>
            </>
          )}
        </p>
      )}

      {target && check && (
        <div className="tax-change">
          {check.options.length > 0 ? (
            <>
              <span className="field-label">
                {cap(everyWord(target))} — з якого кварталу?
              </span>
              <div className="chips">
                {check.options.map((o) => (
                  <button key={o.from} className="chip" aria-pressed={chosen?.from === o.from} onClick={() => setFrom(o.from)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="field-hint bad">Зараз цю зміну зробити не можна.</span>
          )}
          {blocked && (
            <p className="field-hint">
              Раніше не можна: {taxLabel(kind)} за {periodLabel(blocked.period, true)} вже внесено {isQuarter(blocked.period) ? 'за весь квартал' : 'за окремий місяць'}.
              Щоб змінити й той період, спершу видаліть або виправте ту сплату.
            </p>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={() => setTarget(null)}>
              Скасувати
            </button>
            <button className="btn btn-primary" disabled={!chosen} onClick={apply}>
              Застосувати
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
