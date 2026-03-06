import { useState, useMemo, useEffect, useRef } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const START_YEAR = new Date().getFullYear();

const INSURERS = [
  { id: "hcf",      name: "HCF",           tiers: [{ label: "Bronze",  monthly: 180 }, { label: "Silver+", monthly: 320 }, { label: "Gold", monthly: 520 }] },
  { id: "medibank", name: "Medibank",       tiers: [{ label: "Bronze",  monthly: 175 }, { label: "Silver+", monthly: 310 }, { label: "Gold", monthly: 510 }] },
  { id: "bupa",     name: "Bupa",           tiers: [{ label: "Bronze",  monthly: 185 }, { label: "Silver+", monthly: 330 }, { label: "Gold", monthly: 535 }] },
  { id: "nib",      name: "nib",            tiers: [{ label: "Bronze",  monthly: 170 }, { label: "Silver+", monthly: 305 }, { label: "Gold", monthly: 500 }] },
  { id: "ahm",      name: "ahm",            tiers: [{ label: "Bronze",  monthly: 165 }, { label: "Silver+", monthly: 295 }, { label: "Gold", monthly: 490 }] },
  { id: "other",    name: "Other / Manual", tiers: [] },
];

const COVER_MULTIPLIERS = { single: 1.0, couple: 1.75, family: 2.2 };
const COVER_LABELS      = { single: "Single", couple: "Couple", family: "Family" };

const MLS_THRESHOLDS = {
  single: { base: 101000, tiers: [{ limit: 118000, rate: 0.01 }, { limit: 158000, rate: 0.0125 }, { limit: Infinity, rate: 0.015 }] },
  couple: { base: 202000, tiers: [{ limit: 236000, rate: 0.01 }, { limit: 316000, rate: 0.0125 }, { limit: Infinity, rate: 0.015 }] },
  family: { base: 202000, tiers: [{ limit: 236000, rate: 0.01 }, { limit: 316000, rate: 0.0125 }, { limit: Infinity, rate: 0.015 }] },
};

const FAQS = [
  { q: "What is Private Health Insurance (PHI)?", a: "PHI is optional health coverage you pay for privately, on top of Medicare. It gives you access to private hospitals, choice of specialist, and extras like dental and optical — removing you from public waiting lists for elective procedures." },
  { q: "Do I have to get PHI?", a: "No. Medicare covers all Australians for essential medical treatment. PHI is a choice. However, higher earners without PHI pay an additional tax called the Medicare Levy Surcharge (MLS)." },
  { q: "What is the Medicare Levy Surcharge (MLS)?", a: "An extra tax of 1–1.5% of your taxable income if you earn above the income threshold and don't hold private hospital cover. It is deliberately priced so that the MLS costs roughly the same as basic hospital cover — a government nudge to take out PHI." },
  { q: "What is LHC loading?", a: "Lifetime Health Cover (LHC) loading. For every year you delay taking out hospital cover past age 30, your premium increases by 2%, up to a maximum of 70%. It applies for 10 continuous years of cover, then disappears permanently." },
  { q: "Does PHI cover overseas treatment?", a: "Generally no. Australian PHI covers treatment at Australian registered facilities only. For overseas emergencies, you need travel insurance. Australia has reciprocal healthcare agreements with 11 countries including the UK and New Zealand for emergency and essential care." },
  { q: "Is the investment return in the Self-Insure model pre or post tax?", a: "Enter your net (after-tax) expected return. Investment returns in Australia are typically taxable. Consult your accountant or financial adviser for your applicable after-tax rate." },
  { q: "What hospital cover tiers are available?", a: "Australian hospital cover has four government-defined tiers: Basic, Bronze, Silver, and Gold. Gold covers all 38 clinical categories including heart surgery, cancer treatment and joint replacements. Extras (dental, optical, physio) are a separate product that can be combined with any hospital tier." },
  { q: "Can children stay on a family policy?", a: "Yes. Dependent children are covered at no extra premium cost on a family policy, typically until age 22 (or 25 if a full-time student). After that they need their own policy, and their own LHC clock starts from age 30." },
  { q: "What is the Government PHI Rebate?", a: "A government subsidy on your PHI premium, income-tested and adjusted annually. Higher income earners receive a lower rebate or none at all. Your insurer applies it automatically — confirm your entitlement with your accountant." },
];

const MAIN_DISCLAIMER = "Disclaimer: Hypothetical projections based on user inputs. For educational and research purposes only. Not financial, investment, tax, health or insurance advice. No guarantee of outcomes or accuracy. For Australian residents only. Always read your insurer's Product Disclosure Statement (PDS) and consult a licensed professional before making any decisions.";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function currency(n) {
  if (!n && n !== 0) return "—";
  return "$" + Math.round(n).toLocaleString("en-AU");
}

function calcLhcLoading(age) {
  if (age <= 30) return 0;
  return Math.min((age - 30) * 2, 70);
}

function getMlsRate(combinedIncome, coverLevel, numDependants) {
  const t = MLS_THRESHOLDS[coverLevel] || MLS_THRESHOLDS.single;
  const bonus = coverLevel === "family" && numDependants > 1 ? (numDependants - 1) * 1500 : 0;
  if (combinedIncome <= t.base + bonus) return 0;
  for (const tier of t.tiers) { if (combinedIncome < tier.limit) return tier.rate; }
  return 0.015;
}

function buildProjection({ baseMonthly, members, coverLevel, lhcApplies, years }) {
  if (!baseMonthly) return Array.from({ length: years }, (_, i) => ({
    year: i + 1, calYear: START_YEAR + i, annual: 0, cumulative: 0, sizeLabel: "No cover", note: "",
  }));

  const adults   = members.filter(m => m.type === "adult").sort((a, b) => b.age - a.age);
  const children = members.filter(m => m.type === "child");
  const avgLhc   = adults.length ? adults.reduce((s, m) => s + calcLhcLoading(m.age), 0) / adults.length : 0;
  const lhcMult  = lhcApplies ? 1 + avgLhc / 100 : 1;
  const lhcClearYear = START_YEAR + 10;

  const adultEndYears = adults.map(a => ({
    name: a.name,
    endYear: START_YEAR + ((a.plannedDeathAge || 85) - a.age),
  }));

  const childAgeOffEvents = children.map(c => ({
    name: c.name, year: START_YEAR + (22 - c.age),
  })).filter(e => e.year >= START_YEAR);

  let cumulative = 0;
  return Array.from({ length: years }, (_, i) => {
    const yearNum = i + 1;
    const calYear = START_YEAR + i;
    const lhcFactor = lhcApplies && calYear < lhcClearYear ? lhcMult : 1;
    const inflation = Math.pow(1.04, i);

    const aliveAdults    = adultEndYears.filter(a => a.endYear > calYear).length;
    const activeChildren = children.filter(c => (START_YEAR + (22 - c.age)) > calYear).length;

    let fsm = 1.0, sizeLabel = COVER_LABELS[coverLevel];
    if (aliveAdults === 0) { fsm = 0; sizeLabel = "Policy ended"; }
    else if (aliveAdults === 1 && activeChildren > 0 && coverLevel === "family") {
      // Single parent with kids still on policy - full family rate
      fsm = 1.0;
      sizeLabel = "Single parent family";
    } else if (aliveAdults === 1 && activeChildren === 0) {
      // Down to just one adult - single rate
      fsm = COVER_MULTIPLIERS.single / COVER_MULTIPLIERS[coverLevel];
      sizeLabel = "Single";
    } else if (aliveAdults === 2 && activeChildren === 0 && coverLevel === "family") {
      // Both adults, kids gone - couple rate
      fsm = COVER_MULTIPLIERS.couple / COVER_MULTIPLIERS[coverLevel];
      sizeLabel = "Couple";
    } else if (aliveAdults >= 2 && activeChildren === 0 && coverLevel === "couple") {
      fsm = 1.0;
      sizeLabel = "Couple";
    }

    const notes = [];
    if (calYear === lhcClearYear && lhcApplies) notes.push("LHC loading removed ✓");
    childAgeOffEvents.filter(e => e.year === calYear).forEach(e => notes.push(`${e.name} ages off policy (22)`));
    adultEndYears.forEach(a => {
      if (a.endYear === calYear) notes.push(`${a.name} — end of life planning horizon`);
    });

    const annual = baseMonthly * 12 * lhcFactor * inflation * fsm;
    cumulative += annual;
    return { year: yearNum, calYear, annual: Math.round(annual), cumulative: Math.round(cumulative), sizeLabel, note: notes.join(" · ") };
  });
}

// ─── UI PRIMITIVES ───────────────────────────────────────────────────────────

function MCard({ children, className = "", active = false, style: extraStyle = {} }) {
  return (
    <div style={{
      background: "rgba(30, 41, 59, 0.85)",
      border: active ? "1px solid rgba(251,191,36,0.6)" : "1px solid rgba(71,85,105,0.5)",
      borderRadius: 16,
      padding: 16,
      boxShadow: active
        ? "0 0 0 3px rgba(251,191,36,0.1), 0 4px 24px rgba(0,0,0,0.4)"
        : "0 2px 12px rgba(0,0,0,0.3)",
      transition: "box-shadow 0.2s, border-color 0.2s",
      ...extraStyle,
    }} className={className}>
      {children}
    </div>
  );
}

function GlowCard({ children, color = "amber" }) {
  const g = {
    amber: { b: "rgba(251,191,36,0.35)",  s: "rgba(251,191,36,0.08)"  },
    red:   { b: "rgba(248,113,113,0.35)", s: "rgba(248,113,113,0.08)" },
    blue:  { b: "rgba(96,165,250,0.35)",  s: "rgba(96,165,250,0.08)"  },
    green: { b: "rgba(52,211,153,0.35)",  s: "rgba(52,211,153,0.08)"  },
  }[color] || { b: "rgba(251,191,36,0.35)", s: "rgba(251,191,36,0.08)" };
  return (
    <div style={{
      background: "rgba(30,41,59,0.85)",
      border: `1px solid ${g.b}`,
      borderRadius: 16,
      padding: 16,
      boxShadow: `0 0 0 3px ${g.s}, 0 4px 20px rgba(0,0,0,0.35)`,
    }}>
      {children}
    </div>
  );
}

function StatGrid({ stats }) {
  const colorMap = {
    "text-amber-400":   "#fbbf24",
    "text-emerald-400": "#34d399",
    "text-red-400":     "#f87171",
    "text-blue-400":    "#60a5fa",
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: stats.length === 1 ? "1fr" : "1fr 1fr", gap: 10 }}>
      {stats.map((s, i) => (
        <div key={i} style={{ background: "rgba(51,65,85,0.45)", borderRadius: 14, padding: 12, textAlign: "center", border: "1px solid rgba(71,85,105,0.35)" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 19, fontWeight: "bold", color: colorMap[s.color] || "#f1f5f9" }}>{s.value}</div>
          {s.sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginTop: 20, marginBottom: 8 }}>
      <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Toggle({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "rgba(51,65,85,0.5)", borderRadius: 14, padding: 4 }}>
      {options.map(o => (
        <button key={String(o.value)} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 12, fontWeight: "600",
          background: value === o.value ? "#f59e0b" : "transparent",
          color: value === o.value ? "#1e293b" : "#cbd5e1",
          border: "none", cursor: "pointer", transition: "all 0.15s",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Disclosure({ text }) {
  return <p style={{ fontSize: 11, color: "#475569", fontStyle: "italic", lineHeight: 1.5, marginTop: 10 }}>{text}</p>;
}

function FInput({ label, ...props }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{label}</div>}
      <input {...props} style={{
        width: "100%", background: "rgba(51,65,85,0.55)", border: "1px solid rgba(71,85,105,0.55)",
        color: "#f1f5f9", fontSize: 14, borderRadius: 12, padding: "10px 12px",
        outline: "none", boxSizing: "border-box", ...(props.style || {})
      }} />
    </div>
  );
}

// ─── QUESTIONNAIRE ───────────────────────────────────────────────────────────

function Questionnaire({ onComplete, existingConfig }) {
  const [step, setStep]             = useState(0);
  const [coverLevel, setCoverLevel] = useState(existingConfig?.coverLevel || "family");
  const [members, setMembers]       = useState(existingConfig?.members || [
    { id: 1, name: "", age: "", income: "", plannedDeathAge: "85", type: "adult" },
    { id: 2, name: "", age: "", income: "", plannedDeathAge: "85", type: "adult" },
  ]);
  const [insurerId, setInsurerId]   = useState(existingConfig?.insurerId || "hcf");
  const [tierId, setTierId]         = useState(() => {
    if (!existingConfig) return 2;
    const ins = INSURERS.find(i => i.id === existingConfig.insurerId);
    return ins?.tiers?.findIndex(t => t.label === existingConfig.tierLabel) ?? 2;
  });
  const [manualMonthly, setManualMonthly] = useState(existingConfig?.insurerId === "other" ? String(existingConfig.baseMonthly) : "");
  const [lhcApplies, setLhcApplies] = useState(existingConfig?.lhcApplies ?? true);
  const topRef = useRef(null);

  const insurer  = INSURERS.find(i => i.id === insurerId);
  const adults   = members.filter(m => m.type === "adult");
  const children = members.filter(m => m.type === "child");

  const updateMember = (id, field, val) =>
    setMembers(p => p.map(m => m.id === id ? { ...m, [field]: val } : m));

  // Sync adult count when cover level changes
  useEffect(() => {
    if (coverLevel === "single") {
      setMembers(p => {
        const ads = p.filter(m => m.type === "adult");
        const kids = p.filter(m => m.type !== "adult");
        return [ads[0], ...kids];
      });
    }
    if (coverLevel === "couple" && adults.length < 2) {
      setMembers(p => [...p, { id: Date.now(), name: "", age: "", income: "", plannedDeathAge: "85", type: "adult" }]);
    }
  }, [coverLevel]);

  const addChild = () => {
    setMembers(p => [...p, { id: Date.now(), name: "", age: "", income: "", type: "child" }]);
    setCoverLevel("family");
  };
  const removeMember = (id) => setMembers(p => p.filter(m => m.id !== id));

  const goStep = (n) => {
    setStep(n);
    // Scroll the outer page wrapper to top immediately on step change
    setTimeout(() => {
      if (topRef.current) {
        topRef.current.scrollTop = 0;
        topRef.current.scrollIntoView({ behavior: "instant", block: "start" });
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    }, 10);
  };

  const baseFromInsurer = () => {
    if (insurerId === "other") return Number(manualMonthly) || 0;
    const t = insurer?.tiers?.[tierId];
    return t ? Math.round(t.monthly * COVER_MULTIPLIERS[coverLevel]) : 0;
  };

  const canProceed = step === 0 ? adults.every(m => m.name && m.age) : (insurerId === "other" ? !!manualMonthly : true);

  const handleComplete = () => {
    const base    = baseFromInsurer();
    const parsed  = members.map(m => ({ ...m, age: Number(m.age), income: Number(m.income), plannedDeathAge: Number(m.plannedDeathAge) || 85 }));
    const combined = parsed.filter(m => m.type === "adult").reduce((s, m) => s + m.income, 0);
    const numDep  = children.length;
    const mlsRate = getMlsRate(combined, coverLevel, numDep);
    const avgLhc  = parsed.filter(m => m.type === "adult").reduce((s, m) => s + calcLhcLoading(m.age), 0) / Math.max(parsed.filter(m => m.type === "adult").length, 1);
    const maxYears = Math.max(...parsed.filter(m => m.type === "adult").map(m => (m.plannedDeathAge || 85) - m.age), 20);
    onComplete({
      members: parsed, coverLevel,
      insurerId, insurerName: insurer?.name || "Other",
      tierLabel: insurer?.tiers?.[tierId]?.label || "Manual",
      baseMonthly: base, lhcApplies, avgLhc,
      combinedIncome: combined, mlsRate, mlsCost: combined * mlsRate,
      numDependants: numDep, projectionYears: Math.min(maxYears, 60),
    });
  };

  const S = { color: "#f1f5f9" };

  return (
    <div ref={topRef} style={{ background: "#0f172a", minHeight: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: 480, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1e293b,#0f172a)", borderBottom: "1px solid #1e3a5f", padding: "20px 16px 14px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>🇦🇺 For Australian Residents Only</div>
        <div style={{ color: "#f1f5f9", fontWeight: "bold", fontSize: 20, lineHeight: 1.25 }}>Should I get Private<br />Health Insurance?</div>
        <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 4 }}>A personal decision model · Step {step + 1} of 2</div>
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {[0, 1].map(i => <div key={i} style={{ height: 3, flex: 1, borderRadius: 4, background: i <= step ? "#fbbf24" : "rgba(51,65,85,0.8)", transition: "background 0.3s" }} />)}
        </div>
      </div>

      <div style={{ padding: "20px 16px 130px" }}>
        {/* ── STEP 1 ── */}
        {step === 0 && (
          <>
            <div style={{ color: "#f1f5f9", fontWeight: "bold", fontSize: 18, marginBottom: 4 }}>Who's covered?</div>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>Tell us about the people on this policy</div>

            <SectionHeader title="Cover Type" />
            <Toggle options={[{ value: "single", label: "Single" }, { value: "couple", label: "Couple" }, { value: "family", label: "Family" }]} value={coverLevel} onChange={setCoverLevel} />

            <SectionHeader title="Adults on policy" />
            {adults.map((m, idx) => (
              <div key={m.id} style={{ marginBottom: 12 }}>
                <GlowCard color="amber">
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>Adult {idx + 1}</div>
                  <FInput placeholder="Full name" value={m.name} onChange={e => updateMember(m.id, "name", e.target.value)} style={{ marginBottom: 8 }} />
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <FInput label="Age" type="number" min="18" max="100" placeholder="e.g. 45" value={m.age} onChange={e => updateMember(m.id, "age", e.target.value)} />
                    <FInput label="Annual income ($)" type="number" placeholder="e.g. 85000" value={m.income} onChange={e => updateMember(m.id, "income", e.target.value)} />
                  </div>
                  <FInput label="Life planning horizon — age" type="number" min="50" max="110" placeholder="e.g. 85" value={m.plannedDeathAge}
                    onChange={e => updateMember(m.id, "plannedDeathAge", e.target.value)} />
                  <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>The age to which you'd like to model insurance cover — used to personalise your cost projection.</div>
                  {idx === 1 && coverLevel !== "couple" && (
                    <button onClick={() => { removeMember(m.id); setCoverLevel("single"); }} style={{ color: "#f87171", fontSize: 12, marginTop: 8, background: "none", border: "none", cursor: "pointer" }}>Remove</button>
                  )}
                </GlowCard>
              </div>
            ))}

            {coverLevel === "family" && (
              <>
                <SectionHeader title="Children" sub="Covered at no extra premium cost until age 22" />
                {children.map((c, idx) => (
                  <div key={c.id} style={{ marginBottom: 10 }}>
                    <MCard>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                        <FInput placeholder={`Child ${idx + 1} name`} value={c.name} onChange={e => updateMember(c.id, "name", e.target.value)} />
                        <FInput label="Age" type="number" min="0" max="21" placeholder="Age" value={c.age} onChange={e => updateMember(c.id, "age", e.target.value)} style={{ width: 90, flexShrink: 0 }} />
                        <button onClick={() => removeMember(c.id)} style={{ color: "#f87171", fontSize: 22, fontWeight: "bold", paddingBottom: 4, background: "none", border: "none", cursor: "pointer" }}>×</button>
                      </div>
                    </MCard>
                  </div>
                ))}
                <button onClick={addChild} style={{ width: "100%", padding: 12, borderRadius: 14, background: "rgba(51,65,85,0.4)", border: "1px solid rgba(71,85,105,0.5)", color: "#cbd5e1", fontSize: 14, cursor: "pointer", marginTop: 4 }}>
                  + Add child
                </button>
              </>
            )}
          </>
        )}

        {/* ── STEP 2 ── */}
        {step === 1 && (
          <>
            <div style={{ color: "#f1f5f9", fontWeight: "bold", fontSize: 18, marginBottom: 4 }}>Choose your insurer</div>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>Select a provider and cover level</div>

            <SectionHeader title="Insurer" />
            {INSURERS.map(ins => (
              <button key={ins.id} onClick={() => { setInsurerId(ins.id); if (ins.tiers.length) setTierId(2); }}
                style={{
                  display: "block", width: "100%", padding: "12px 16px", borderRadius: 14, textAlign: "left",
                  fontSize: 14, fontWeight: "600", marginBottom: 8,
                  background: insurerId === ins.id ? "rgba(120,53,15,0.3)" : "rgba(30,41,59,0.85)",
                  border: `1px solid ${insurerId === ins.id ? "rgba(251,191,36,0.6)" : "rgba(71,85,105,0.5)"}`,
                  color: insurerId === ins.id ? "#fbbf24" : "#cbd5e1",
                  boxShadow: insurerId === ins.id ? "0 0 0 2px rgba(251,191,36,0.1)" : "none",
                  cursor: "pointer", transition: "all 0.15s",
                }}>
                {ins.name}
              </button>
            ))}

            {insurerId !== "other" && insurer?.tiers?.length > 0 && (
              <>
                <SectionHeader title="Cover level" />
                {insurer.tiers.map((t, idx) => {
                  const mo = Math.round(t.monthly * COVER_MULTIPLIERS[coverLevel]);
                  const active = tierId === idx;
                  return (
                    <button key={idx} onClick={() => setTierId(idx)} style={{
                      display: "block", width: "100%", padding: "12px 16px", borderRadius: 14, textAlign: "left",
                      marginBottom: 8,
                      background: active ? "rgba(120,53,15,0.3)" : "rgba(30,41,59,0.85)",
                      border: `1px solid ${active ? "rgba(251,191,36,0.6)" : "rgba(71,85,105,0.5)"}`,
                      boxShadow: active ? "0 0 0 2px rgba(251,191,36,0.1)" : "none",
                      cursor: "pointer", transition: "all 0.15s",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: "600", fontSize: 14, color: active ? "#fbbf24" : "#cbd5e1" }}>{t.label}</span>
                        <span style={{ fontWeight: "bold", fontSize: 14, color: "#f1f5f9" }}>{currency(mo)}/mo</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{currency(mo * 12)}/yr · {COVER_LABELS[coverLevel]} rate (indicative)</div>
                    </button>
                  );
                })}
              </>
            )}

            {insurerId === "other" && (
              <>
                <SectionHeader title="Monthly premium" sub="Enter your quoted amount" />
                <FInput type="number" placeholder="e.g. 650" value={manualMonthly} onChange={e => setManualMonthly(e.target.value)} />
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Enter the total monthly premium for your {COVER_LABELS[coverLevel]} policy.</div>
              </>
            )}

            <SectionHeader title="LHC Loading" sub="Applies if any adult has not held hospital cover since age 30" />
            <Toggle options={[{ value: true, label: "Yes — loading applies" }, { value: false, label: "No loading" }]} value={lhcApplies} onChange={setLhcApplies} />
            {lhcApplies && adults.filter(m => m.age).map(m => {
              const loading = calcLhcLoading(Number(m.age));
              return loading > 0 ? (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(51,65,85,0.5)", fontSize: 12 }}>
                  <span style={{ color: "#94a3b8" }}>{m.name || "Adult"} (age {m.age})</span>
                  <span style={{ color: "#fbbf24", fontWeight: "600" }}>{loading}% loading</span>
                </div>
              ) : null;
            })}
            <Disclosure text="LHC loading = (age − 30) × 2%, capped at 70%. New migrants to Australia have 12 months from Medicare registration to take out cover without loading. Verify your exact loading with your chosen insurer." />
          </>
        )}
      </div>

      {/* Fixed nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, background: "rgba(15,23,42,0.97)", borderTop: "1px solid #1e3a5f", padding: "12px 16px 24px", zIndex: 20 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={() => goStep(0)} style={{ flex: 1, padding: 14, borderRadius: 14, background: "rgba(51,65,85,0.5)", color: "#cbd5e1", fontSize: 14, fontWeight: "600", border: "1px solid rgba(71,85,105,0.5)", cursor: "pointer" }}>← Back</button>
          )}
          {step < 1 ? (
            <button onClick={() => canProceed && goStep(1)} disabled={!canProceed} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 14, fontWeight: "bold", background: canProceed ? "#f59e0b" : "rgba(51,65,85,0.4)", color: canProceed ? "#1e293b" : "#475569", border: "none", cursor: canProceed ? "pointer" : "default" }}>Next →</button>
          ) : (
            <button onClick={() => canProceed && handleComplete()} disabled={!canProceed} style={{ flex: 1, padding: 14, borderRadius: 14, fontSize: 14, fontWeight: "bold", background: canProceed ? "#f59e0b" : "rgba(51,65,85,0.4)", color: canProceed ? "#1e293b" : "#475569", border: "none", cursor: canProceed ? "pointer" : "default" }}>Build My Model →</button>
          )}
        </div>
        <p style={{ fontSize: 10, color: "#334155", textAlign: "center", marginTop: 8, fontStyle: "italic" }}>For Australian residents only · Educational purposes only · Not advice</p>
      </div>
    </div>
  );
}

// ─── MAIN TOOL ────────────────────────────────────────────────────────────────

const NAV_ICONS = {
  summary:  ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  ),
  levy:     ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  cost:     ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  invest:   ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
    </svg>
  ),
  coverage: ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  faq:      ({ active }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#fbbf24" : "#94a3b8"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
};

const SCREENS = [
  { id: "summary",  label: "Summary" },
  { id: "levy",     label: "Levy"    },
  { id: "cost",     label: "Cost"    },
  { id: "invest",   label: "Invest"  },
  { id: "coverage", label: "Cover"   },
  { id: "faq",      label: "FAQ"     },
];

function MainTool({ config, onReset }) {
  const [screen, setScreen] = useState("summary");
  const contentRef = useRef(null);

  const go = (id) => {
    setScreen(id);
    setTimeout(() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 30);
  };

  const renderScreen = () => {
    switch (screen) {
      case "summary":  return <SummaryScreen  config={config} />;
      case "levy":     return <LevyScreen     config={config} />;
      case "cost":     return <CostScreen     config={config} />;
      case "invest":   return <InvestScreen   config={config} />;
      case "coverage": return <CoverageScreen />;
      case "faq":      return <FaqScreen />;
      default:         return <SummaryScreen  config={config} />;
    }
  };

  const current = SCREENS.find(s => s.id === screen);

  return (
    <div style={{ background: "#0f172a", height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ background: "linear-gradient(135deg,#1e293b,#0f172a)", borderBottom: "1px solid #1e3a5f", padding: "14px 16px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ color: "#fbbf24", fontSize: 10, fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.1em" }}>Private Health Insurance · Decision Model</div>
            <div style={{ color: "#f1f5f9", fontWeight: "bold", fontSize: 16, marginTop: 2 }}>PHI — Should I or Shouldn't I?</div>
          </div>
          <button onClick={onReset} style={{ fontSize: 11, color: "#94a3b8", background: "rgba(51,65,85,0.5)", border: "1px solid rgba(71,85,105,0.5)", borderRadius: 10, padding: "6px 12px", cursor: "pointer" }}>Edit inputs</button>
        </div>
        <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
          {config.insurerName} · {config.tierLabel} · {COVER_LABELS[config.coverLevel]} · {currency(config.baseMonthly)}/mo base
        </div>
      </div>

      <div ref={contentRef} style={{ flex: 1, overflowY: "auto", padding: "14px 16px 16px" }}>
        <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>{current?.icon} {current?.label}</div>
        {renderScreen()}
      </div>

      <div style={{ background: "rgba(15,23,42,0.97)", borderTop: "1px solid #1e3a5f", display: "flex", flexShrink: 0 }}>
        {SCREENS.map(s => {
          const Icon = NAV_ICONS[s.id];
          const active = screen === s.id;
          return (
            <button key={s.id} onClick={() => go(s.id)} style={{
              flex: 1, padding: "10px 2px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer",
            }}>
              <Icon active={active} />
              <span style={{ fontSize: 9, color: active ? "#fbbf24" : "#f1f5f9", fontWeight: active ? "bold" : "normal" }}>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── SUMMARY SCREEN ──────────────────────────────────────────────────────────

function SummaryScreen({ config }) {
  const { members, coverLevel, baseMonthly, lhcApplies, avgLhc, combinedIncome, mlsRate, mlsCost, insurerName, tierLabel, projectionYears } = config;
  const adults  = members.filter(m => m.type === "adult");
  const children = members.filter(m => m.type === "child");
  const monthly = baseMonthly * (lhcApplies ? 1 + avgLhc / 100 : 1);
  const proj    = useMemo(() => buildProjection({ baseMonthly, members, coverLevel, lhcApplies, years: projectionYears }), []);
  const total   = proj[proj.length - 1]?.cumulative || 0;
  const lhcYear = START_YEAR + 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <GlowCard color="amber">
        <div style={{ color: "#fbbf24", fontWeight: "bold", fontSize: 13, marginBottom: 8 }}>Your Policy Summary</div>
        {adults.map(m => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#cbd5e1" }}>{m.name}, age {m.age}</span>
            <span style={{ color: "#fbbf24" }}>{lhcApplies ? `${calcLhcLoading(m.age)}% LHC` : "No LHC"}</span>
          </div>
        ))}
        {children.map(c => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
            <span style={{ color: "#cbd5e1" }}>{c.name}, age {c.age}</span>
            <span style={{ color: "#34d399", fontSize: 11 }}>Free on policy</span>
          </div>
        ))}
      </GlowCard>

      <StatGrid stats={[
        { label: "Base monthly",                       value: currency(baseMonthly),      sub: `${insurerName} ${tierLabel}` },
        { label: `Monthly incl. LHC (${avgLhc.toFixed(0)}%)`, value: lhcApplies ? currency(monthly) : "No loading", color: lhcApplies ? "text-amber-400" : "text-emerald-400" },
        { label: "Annual (Year 1)",                    value: currency(monthly * 12) },
        { label: `Lifetime total (${projectionYears}yr)`, value: currency(total), color: "text-amber-400", sub: "incl. inflation + step-downs" },
      ]} />

      {lhcApplies && (
        <GlowCard color="amber">
          <div style={{ color: "#fbbf24", fontSize: 11, fontWeight: "bold", marginBottom: 6 }}>⚡ LHC Loading Active</div>
          <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>Loading clears permanently in <strong style={{ color: "#f1f5f9" }}>{lhcYear}</strong> after 10 continuous years of hospital cover. Every year of further delay pushes that date out by one year.</p>
        </GlowCard>
      )}

      {mlsRate > 0 && (
        <GlowCard color="red">
          <div style={{ color: "#f87171", fontSize: 11, fontWeight: "bold", marginBottom: 6 }}>⚠ Medicare Levy Surcharge — Active</div>
          <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
            At your combined income of <strong style={{ color: "#f1f5f9" }}>{currency(combinedIncome)}</strong>, without private hospital cover you pay <strong style={{ color: "#f87171" }}>{currency(mlsCost)}/yr</strong> in MLS at a rate of <strong style={{ color: "#f87171" }}>{(mlsRate * 100).toFixed(1)}%</strong> of taxable income — for no health benefit. Taking PHI removes this surcharge entirely.
          </p>
        </GlowCard>
      )}

      <MCard>
        <p style={{ fontSize: 11, color: "#475569", fontStyle: "italic", lineHeight: 1.6 }}>{MAIN_DISCLAIMER}</p>
      </MCard>
    </div>
  );
}

// ─── LEVY SCREEN ─────────────────────────────────────────────────────────────

function LevyScreen({ config }) {
  const { combinedIncome, coverLevel, numDependants, mlsRate, mlsCost, baseMonthly } = config;
  const bonus     = numDependants > 1 ? (numDependants - 1) * 1500 : 0;
  const threshold = 202000 + bonus;
  const triggered = mlsRate > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <GlowCard color="blue">
        <div style={{ color: "#60a5fa", fontWeight: "600", fontSize: 13, marginBottom: 8 }}>What is the Medicare Levy? 🐷</div>
        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>
          Everyone earning income in Australia pays a <strong style={{ color: "#f1f5f9" }}>2% Medicare Levy</strong> — this funds the public health system. On top of that, if you earn above the threshold and don't hold private hospital cover, you pay an extra surcharge (MLS). The MLS is deliberately priced so that at the threshold, it costs roughly the same as basic PHI — making Private Health Insurance the financially neutral or better choice.
        </p>
      </GlowCard>

      <StatGrid stats={[
        { label: "Your combined income",    value: currency(combinedIncome) },
        { label: "MLS family threshold",    value: currency(threshold), sub: `${numDependants} ${numDependants === 1 ? "dependant" : "dependants"}` },
        { label: "MLS triggered?",          value: triggered ? "YES" : "NO", color: triggered ? "text-red-400" : "text-emerald-400" },
        { label: "MLS cost (no PHI)",       value: triggered ? currency(mlsCost) + "/yr" : "$0", color: triggered ? "text-red-400" : "text-emerald-400" },
      ]} />

      {triggered && baseMonthly > 0 && (
        <GlowCard color="amber">
          <div style={{ color: "#fbbf24", fontWeight: "600", fontSize: 13, marginBottom: 8 }}>MLS vs PHI comparison</div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.5)", fontSize: 13 }}>
            <span style={{ color: "#94a3b8" }}>MLS (no PHI)</span>
            <span style={{ color: "#f87171", fontWeight: "bold" }}>{currency(mlsCost)}/yr — no benefit</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13 }}>
            <span style={{ color: "#94a3b8" }}>PHI base premium</span>
            <span style={{ color: "#34d399", fontWeight: "bold" }}>{currency(baseMonthly * 12)}/yr + coverage</span>
          </div>
          <Disclosure text="Confirm your exact MLS liability with your accountant. Income structure and entity arrangements may affect your calculation." />
        </GlowCard>
      )}

      <SectionHeader title="MLS Tiers 2025–26 · Family thresholds" />
      {[
        { tier: "No surcharge", range: "≤ $203,500",  rate: 0,      rateLabel: "0%",    c: "#34d399" },
        { tier: "Tier 1",       range: "$203k–$236k", rate: 0.01,   rateLabel: "1.0%",  c: "#fbbf24" },
        { tier: "Tier 2",       range: "$236k–$316k", rate: 0.0125, rateLabel: "1.25%", c: "#fb923c" },
        { tier: "Tier 3",       range: "$316k+",      rate: 0.015,  rateLabel: "1.5%",  c: "#f87171" },
      ].map(t => (
        <MCard key={t.tier} active={mlsRate === t.rate}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: "#f1f5f9", fontWeight: "600", fontSize: 13 }}>{t.tier}</div>
              <div style={{ color: "#64748b", fontSize: 11 }}>Family: {t.range}</div>
            </div>
            <div style={{ color: t.c, fontSize: 22, fontWeight: "bold" }}>{t.rateLabel}</div>
          </div>
        </MCard>
      ))}
      <Disclosure text="Family MLS threshold increases by $1,500 per dependent child after the first. Thresholds are reviewed annually. Confirm your specific liability with your accountant." />
    </div>
  );
}

// ─── COST SCREEN ─────────────────────────────────────────────────────────────

function CostScreen({ config }) {
  const { baseMonthly, members, coverLevel, lhcApplies, avgLhc, projectionYears } = config;
  const [expanded, setExpanded] = useState(false);
  const lhcMult     = lhcApplies ? 1 + avgLhc / 100 : 1;
  const lhcYear     = START_YEAR + 10;
  const proj        = useMemo(() => buildProjection({ baseMonthly, members, coverLevel, lhcApplies, years: projectionYears }), []);
  const total       = proj[proj.length - 1]?.cumulative || 0;
  const afterLhcRow = proj.find(r => r.calYear === lhcYear);
  const milestones  = proj.filter(r => r.note);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <StatGrid stats={[
        { label: "Monthly today",                         value: currency(baseMonthly * lhcMult), sub: lhcApplies ? `incl. ${avgLhc.toFixed(0)}% LHC` : "No LHC" },
        { label: "Annual Year 1",                         value: currency(baseMonthly * lhcMult * 12) },
        { label: `Annual after LHC removed (${lhcYear})`, value: afterLhcRow ? currency(afterLhcRow.annual) : "—", color: "text-emerald-400" },
        { label: `Lifetime total (${projectionYears}yr)`, value: currency(total), color: "text-amber-400" },
      ]} />

      <SectionHeader title="Policy milestones" sub="Personalised to your life planning horizon" />
      {milestones.map(r => (
        <div key={r.calYear} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(51,65,85,0.45)" }}>
          <div>
            <span style={{ color: "#f1f5f9", fontWeight: "600", fontSize: 14 }}>{r.calYear}</span>
            <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 2 }}>{r.note}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#cbd5e1", fontSize: 13, fontWeight: "600" }}>{currency(r.annual)}/yr</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>{r.sizeLabel}</div>
          </div>
        </div>
      ))}

      <SectionHeader title="Year-by-year detail" />
      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", padding: 12, borderRadius: 14, background: "rgba(51,65,85,0.4)", border: "1px solid rgba(71,85,105,0.5)", color: "#cbd5e1", fontSize: 14, cursor: "pointer" }}>
        {expanded ? "▲ Collapse detail" : "▼ Show all years"}
      </button>
      {expanded && (
        <MCard>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {proj.map(r => (
              <div key={r.year} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.35)", background: r.note ? "rgba(120,53,15,0.08)" : "transparent" }}>
                <div>
                  <span style={{ color: "#f1f5f9", fontWeight: "600", fontSize: 12 }}>{r.calYear}</span>
                  <span style={{ color: "#64748b", fontSize: 11, marginLeft: 8 }}>{r.sizeLabel}</span>
                  {r.note && <div style={{ color: "#fbbf24", fontSize: 11 }}>{r.note}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#cbd5e1", fontSize: 12 }}>{currency(r.annual)}/yr</div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>{currency(r.cumulative)} total</div>
                </div>
              </div>
            ))}
          </div>
        </MCard>
      )}
      <Disclosure text="Premium projections assume 4% annual increases (recent industry average). Actual increases vary by insurer and year. Projection is personalised to your life planning horizon. Family step-downs are modelled at indicative multipliers." />
    </div>
  );
}

// ─── INVEST SCREEN ───────────────────────────────────────────────────────────

function InvestScreen({ config }) {
  const { baseMonthly, members, coverLevel, lhcApplies, projectionYears } = config;

  const DEFAULT_DRAWDOWNS = [
    { id: 1, year: START_YEAR + 10, amount: 50000, label: "Major medical event (est.)" },
    { id: 2, year: START_YEAR + 19, amount: 30000, label: "Dental / ortho accumulated" },
    { id: 3, year: START_YEAR + 29, amount: 80000, label: "Cardiac / cancer (est.)" },
  ];

  const load = (key, fb) => { try { const r = sessionStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch { return fb; } };
  const [rate, setRate]           = useState(() => load("phi_returnRate", 6));
  const [drawdowns, setDrawdowns] = useState(() => load("phi_drawdowns", DEFAULT_DRAWDOWNS));
  const [nextId, setNextId]       = useState(() => Math.max(...load("phi_drawdowns", DEFAULT_DRAWDOWNS).map(d => d.id), 3) + 1);
  const [expanded, setExpanded]   = useState(false);

  useEffect(() => { try { sessionStorage.setItem("phi_drawdowns", JSON.stringify(drawdowns)); } catch {} }, [drawdowns]);
  useEffect(() => { try { sessionStorage.setItem("phi_returnRate", JSON.stringify(rate)); } catch {} }, [rate]);

  const proj = useMemo(() => buildProjection({ baseMonthly, members, coverLevel, lhcApplies, years: projectionYears }), []);

  const selfInsure = useMemo(() => {
    if (!baseMonthly) return [];
    const r = rate / 100, dm = {};
    drawdowns.forEach(d => { dm[d.year] = (dm[d.year] || 0) + d.amount; });
    let bal = 0, td = 0;
    return proj.map(row => {
      bal += row.annual;
      const drawn = dm[row.calYear] || 0;
      td += drawn; bal -= drawn;
      // Allow negative balance — do NOT clamp to 0
      bal = bal * (1 + r);
      return { ...row, drawn, balance: Math.round(bal), totalDrawn: Math.round(td), premiumSaved: row.annual };
    });
  }, [proj, rate, drawdowns, baseMonthly]);

  const finalBalance  = selfInsure[selfInsure.length - 1]?.balance || 0;
  const totalDrawn    = selfInsure[selfInsure.length - 1]?.totalDrawn || 0;
  const totalPremiums = proj[proj.length - 1]?.cumulative || 0;

  const addDD    = () => { setDrawdowns(p => [...p, { id: nextId, year: START_YEAR + 10, amount: 0, label: "" }]); setNextId(n => n + 1); };
  const removeDD = (id) => setDrawdowns(p => p.filter(d => d.id !== id));
  const updateDD = (id, field, val) => setDrawdowns(p => p.map(d => d.id === id ? { ...d, [field]: field === "amount" || field === "year" ? Number(val) : val } : d));

  const tableRows = selfInsure.filter(r => r.drawn > 0 || r.note || r.year === 1 || r.year % 5 === 0);

  const finalYear = selfInsure[selfInsure.length - 1]?.calYear || START_YEAR + projectionYears;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <GlowCard color="blue">
        <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
          Instead of paying PHI premiums, what if you invested that same amount each year at <strong style={{ color: "#fbbf24" }}>{rate}%</strong> net annual return, drawing down when you need medical care? This models your residual balance over your life planning horizon.
        </p>
      </GlowCard>

      <SectionHeader title="Net annual investment return" sub="Enter your expected after-tax return" />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <input type="range" min="2" max="12" step="0.5" value={rate} onChange={e => setRate(Number(e.target.value))} style={{ flex: 1, accentColor: "#fbbf24" }} />
        <span style={{ color: "#fbbf24", fontWeight: "bold", fontSize: 24, width: 56, textAlign: "right" }}>{rate}%</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {[4, 6, 8, 10].map(r => (
          <button key={r} onClick={() => setRate(r)} style={{ flex: 1, padding: "8px 4px", borderRadius: 10, fontSize: 12, fontWeight: "600", background: rate === r ? "#f59e0b" : "rgba(51,65,85,0.5)", color: rate === r ? "#1e293b" : "#94a3b8", border: "none", cursor: "pointer" }}>{r}%</button>
        ))}
      </div>
      <Disclosure text="Enter your net (after-tax) expected return. Investment returns in Australia are typically taxable. Consult your accountant or financial adviser for your applicable after-tax rate." />

      <StatGrid stats={[
        { label: `Premiums invested (${projectionYears}yr)`, value: currency(totalPremiums) },
        { label: "Total medical drawdowns",                  value: currency(totalDrawn),    color: "text-red-400" },
        { label: `Final balance at ${finalYear}`,            value: currency(finalBalance),  color: finalBalance >= 0 ? "text-emerald-400" : "text-red-400", sub: `At ${rate}% net return` },
        { label: "Net position vs PHI",                      value: finalBalance >= 0 ? `+${currency(finalBalance)}` : currency(finalBalance), color: finalBalance >= 0 ? "text-emerald-400" : "text-red-400" },
      ]} />

      <SectionHeader title="Medical cost drawdowns" sub="Edit to model your scenario — recalculates instantly" />
      {drawdowns.map((d, idx) => (
        <MCard key={d.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: "bold", width: 20, paddingTop: 2, flexShrink: 0 }}>{idx + 1}.</div>
            <FInput placeholder="Description (e.g. Heart surgery)" value={d.label} onChange={e => updateDD(d.id, "label", e.target.value)} />
            <button onClick={() => removeDD(d.id)} style={{ color: "#f87171", fontSize: 22, fontWeight: "bold", paddingBottom: 4, background: "none", border: "none", cursor: "pointer" }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <FInput label="Year" type="number" min={START_YEAR} max={START_YEAR + projectionYears} value={d.year} onChange={e => updateDD(d.id, "year", e.target.value)} />
            <FInput label="Cost Expense ($)" type="number" min="0" step="5000" value={d.amount} onChange={e => updateDD(d.id, "amount", e.target.value)} />
          </div>
        </MCard>
      ))}
      <button onClick={addDD} style={{ width: "100%", padding: 12, borderRadius: 14, background: "rgba(51,65,85,0.4)", border: "1px solid rgba(71,85,105,0.5)", color: "#cbd5e1", fontSize: 14, cursor: "pointer" }}>
        + Add medical cost event
      </button>

      <SectionHeader title="Savings balance at key years" />
      <MCard>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: "#64748b" }}>Year 1, every 5 years, milestones & drawdown events</div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: "600" }}>Savings Balance</div>
        </div>
        {tableRows.map(r => {
          const isNeg = r.balance < 0;
          return (
            <div key={r.year} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.4)", background: r.drawn > 0 ? "rgba(127,29,29,0.12)" : "transparent" }}>
              <div>
                <span style={{ color: "#f1f5f9", fontWeight: "600", fontSize: 13 }}>{r.calYear}</span>
                {r.note && <div style={{ color: "#94a3b8", fontSize: 11 }}>{r.note}</div>}
                {r.drawn > 0 && <div style={{ color: "#f87171", fontSize: 11 }}>−{currency(r.drawn)} medical cost</div>}
              </div>
              <span style={{ color: isNeg ? "#f87171" : "#fbbf24", fontWeight: "bold", fontSize: 13 }}>
                {isNeg ? `−${currency(Math.abs(r.balance))}` : currency(r.balance)}
              </span>
            </div>
          );
        })}
      </MCard>

      <button onClick={() => setExpanded(e => !e)} style={{ width: "100%", padding: 12, borderRadius: 14, background: "rgba(51,65,85,0.4)", border: "1px solid rgba(71,85,105,0.5)", color: "#cbd5e1", fontSize: 14, cursor: "pointer" }}>
        {expanded ? "▲ Collapse all years" : "▼ Show every year"}
      </button>
      {expanded && (
        <MCard>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 12px 8px 0", borderBottom: "1px solid rgba(51,65,85,0.4)", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Year · Size</span>
            <span style={{ fontSize: 11, color: "#64748b", fontWeight: "600" }}>Savings Balance</span>
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto", paddingRight: 12 }}>
            {selfInsure.map(r => {
              const isNeg = r.balance < 0;
              return (
                <div key={r.year} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid rgba(51,65,85,0.3)", background: r.drawn > 0 ? "rgba(127,29,29,0.08)" : "transparent" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: "#f1f5f9", fontWeight: "600", fontSize: 11 }}>{r.calYear}</span>
                    <span style={{ color: "#64748b", fontSize: 11, marginLeft: 6 }}>{r.sizeLabel}</span>
                    {r.note && <div style={{ color: "#fbbf24", fontSize: 10 }}>{r.note}</div>}
                    {r.drawn > 0 && <div style={{ color: "#f87171", fontSize: 10 }}>−{currency(r.drawn)}</div>}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, minWidth: 90, paddingLeft: 8 }}>
                    <div style={{ color: "#94a3b8", fontSize: 11 }}>{currency(r.premiumSaved)} invested</div>
                    <div style={{ color: isNeg ? "#f87171" : "#fbbf24", fontWeight: "600", fontSize: 11 }}>
                      {isNeg ? `−${currency(Math.abs(r.balance))}` : currency(r.balance)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </MCard>
      )}
      <Disclosure text="Balance = end-of-year: (prior balance + premium invested − drawdowns) × (1 + net return rate). A negative balance indicates the fund is depleted — this is shown in red as a risk indicator. Enter your after-tax return rate above." />
    </div>
  );
}

// ─── COVERAGE SCREEN ─────────────────────────────────────────────────────────

function CoverageScreen() {
  const items = [
    { t: "Heart Bypass / Vascular",       tiers: { Bronze: "✗ Excluded", "Silver+": "✓ Covered", Gold: "✓ Covered" },         note: "Bronze typically excludes cardiac surgery. Confirm inclusions in your PDS." },
    { t: "Cancer (Chemo / Radiotherapy)", tiers: { Bronze: "Limited",    "Silver+": "✓ Inpatient", Gold: "✓ Covered" },         note: "Cancer as an inpatient is generally covered on Silver+. Confirm with your insurer." },
    { t: "Orthodontics",                  tiers: { Bronze: "✗ Excluded", "Silver+": "✗ Often excluded", Gold: "✓ Top Extras" }, note: "Orthodontics is an Extras product. 12-month waiting period typically applies." },
    { t: "General Dental",                tiers: { Bronze: "✗ Not covered", "Silver+": "✓ Mid Extras", Gold: "✓ Top Extras" }, note: "Dental is an Extras product. Annual limits apply. Check your specific Extras tier." },
    { t: "Joint Replacement",             tiers: { Bronze: "✗ Excluded", "Silver+": "Some plans", Gold: "✓ Covered" },          note: "Joint replacements are a key reason many people choose Gold. Confirm with your insurer." },
    { t: "Mental Health (inpatient)",     tiers: { Bronze: "Limited",    "Silver+": "✓ Covered", Gold: "✓ Covered" },           note: "2-month waiting period applies. Confirm covered days with your insurer." },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <GlowCard color="amber">
        <p style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.6 }}>
          Coverage details below are <strong style={{ color: "#fbbf24" }}>general indicators only</strong>. Always read your insurer's Product Disclosure Statement (PDS) for exact inclusions, exclusions, waiting periods and annual limits. <span style={{ color: "#64748b" }}>Please consult your insurer directly — this information is of a general nature only.</span>
        </p>
      </GlowCard>

      {items.map(item => (
        <MCard key={item.t}>
          <div style={{ color: "#f1f5f9", fontWeight: "bold", fontSize: 13, marginBottom: 8 }}>{item.t}</div>
          {Object.entries(item.tiers).map(([tier, val]) => (
            <div key={tier} style={{ display: "flex", gap: 8, fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: "#64748b", width: 60, flexShrink: 0 }}>{tier}:</span>
              <span style={{ color: val.startsWith("✓") ? "#34d399" : val.startsWith("✗") ? "#f87171" : "#fbbf24" }}>{val}</span>
            </div>
          ))}
          <Disclosure text={item.note} />
        </MCard>
      ))}

      <SectionHeader title="Waiting periods (typical)" />
      {[
        { item: "Pre-existing conditions",     wait: "12 months", c: "#fbbf24" },
        { item: "Orthodontics / major dental", wait: "12 months", c: "#fbbf24" },
        { item: "Psychiatric care",            wait: "2 months",  c: "#60a5fa" },
        { item: "All other hospital",          wait: "2 months",  c: "#60a5fa" },
        { item: "Emergency",                   wait: "No wait",   c: "#34d399" },
      ].map(w => (
        <div key={w.item} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(51,65,85,0.45)", fontSize: 13 }}>
          <span style={{ color: "#94a3b8" }}>{w.item}</span>
          <span style={{ color: w.c, fontWeight: "600" }}>{w.wait}</span>
        </div>
      ))}

      <SectionHeader title="Overseas treatment" />
      <MCard>
        <p style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 8, lineHeight: 1.6 }}>Australian Private Health Insurance generally covers treatment at Australian registered facilities only.</p>
        <p style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>Australia has reciprocal healthcare agreements with 11 countries (including UK and NZ) for emergency and essential care when visiting.</p>
        <Disclosure text="Coverage details vary significantly by insurer and policy. Please consult your insurer directly for guidance specific to your policy and any overseas scenarios. This information is of a general nature only." />
      </MCard>

      <MCard>
        <p style={{ fontSize: 11, color: "#475569", fontStyle: "italic", lineHeight: 1.6 }}>{MAIN_DISCLAIMER}</p>
      </MCard>
    </div>
  );
}

// ─── FAQ SCREEN ──────────────────────────────────────────────────────────────

function FaqScreen() {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <GlowCard color="blue">
        <p style={{ fontSize: 12, color: "#cbd5e1" }}>Common questions about Private Health Insurance (PHI) in Australia. Tap any question to expand.</p>
      </GlowCard>
      {FAQS.map((faq, i) => (
        <MCard key={i} active={open === i}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: "600", color: open === i ? "#fbbf24" : "#f1f5f9", lineHeight: 1.4 }}>{faq.q}</span>
              <span style={{ color: "#fbbf24", fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{open === i ? "−" : "+"}</span>
            </div>
          </button>
          {open === i && (
            <p style={{ fontSize: 13, color: "#cbd5e1", marginTop: 10, lineHeight: 1.6, borderTop: "1px solid rgba(51,65,85,0.5)", paddingTop: 10 }}>{faq.a}</p>
          )}
        </MCard>
      ))}
      <MCard>
        <p style={{ fontSize: 11, color: "#475569", fontStyle: "italic", lineHeight: 1.6 }}>{MAIN_DISCLAIMER}</p>
      </MCard>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [config, setConfig] = useState(null);
  const [lastConfig, setLastConfig] = useState(null);
  const handleComplete = (c) => { setLastConfig(c); setConfig(c); };
  if (!config) return <Questionnaire onComplete={handleComplete} existingConfig={lastConfig} />;
  return <MainTool config={config} onReset={() => setConfig(null)} />;
}
