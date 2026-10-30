/* ============================================================
   LIVE LEVELS ENGINE  (EVENT LEVELS tab)
   Overall Approval Level = MAX() of every individual trigger's
   minimum level. Re-evaluated on every answer change (§5).

   Each trigger: fn(answers) => { level, reason } | null
   A null means "this factor does not apply / not yet answered".
   ============================================================ */
(function (NVC) {

  const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  };

  /* ============================================================
     TUNABLE SETTINGS — edit these to change how the live level behaves.
     (This is Council policy, so it's deliberately kept together and
     plain-English. Change a number, save the file, reload the page.)
     ============================================================ */
  NVC.TUNE = {
    // Minimum Approval Level driven by ATTENDANCE ALONE.
    // Read top-to-bottom: the first band whose "from" the attendance
    // reaches sets the level. Raise/lower the "from" numbers to taste.
    ATTENDANCE_BANDS: [
      { from: 5000, level: 4, label: '5,000+ attendees' },
      { from: 2000, level: 3, label: '2,000–4,999 attendees' },
      { from: 50,   level: 2, label: '50–1,999 attendees' },
      { from: 0,    level: 1, label: 'Under 50 attendees' },
    ],
    // A single marquee at/above this area (m²) forces Level 4.
    MARQUEE_L4_AREA: 100,
    // COUNCIL DOCUMENTATION CHECKLIST deadlines, counted back from the event date.
    // Application lead time by Approval Level (Level 1 has no engagement with Council).
    APPLICATION_LEAD: {
      2: { businessDays: 10, label: '10 business days' },
      3: { months: 3, label: '3 months' },
      4: { months: 6, label: '6 months' },
    },
    // Final documents (those issued by a third party close to the event) are due this many days out.
    FINAL_DOCS_DAYS: 14,
    // Documentation pane colour thresholds (business days until due):
    //   overdue -> red, fewer than DOC_GREEN_DAYS -> amber, DOC_GREEN_DAYS or more -> green.
    DOC_GREEN_DAYS: 10,
  };

  NVC.LEVEL_META = {
    0: { name: '—',                  desc: 'Answer a few questions to see your indicative Approval Level.', timeframe: '', color: 'var(--lvl-none)' },
    1: { name: 'Self-Managed',       desc: 'No Council approval needed. Follow the standard conditions.',   timeframe: 'No lead time', color: 'var(--lvl-1)', sitePlan: 'Not required' },
    2: { name: 'Standard / Fast-Track', desc: 'Single department, low risk, established / pre-approved site.', timeframe: '5–10 business days', color: 'var(--lvl-2)', sitePlan: 'Hand-marked aerial photo' },
    3: { name: 'Multi-Agency',       desc: 'Road closure and/or multiple departments involved.',            timeframe: '3 months', color: 'var(--lvl-3)', sitePlan: 'To-scale site plan' },
    4: { name: 'Major / Complex',    desc: 'State significance, multi-day, or major infrastructure / safety impact.', timeframe: '6 months', color: 'var(--lvl-4)', sitePlan: 'To-scale site plan' },
  };

  /* LEVEL 1 — SELF-MANAGED. No approval and no contact with Council: the Action Plan is a
     single page listing these standard conditions. Wording is Council's to confirm. */
  NVC.LEVEL1_CONDITIONS = [
    'Keep it small — under 50 people at the busiest moment',
    'Bring no infrastructure — no marquees, stages or generators',
    'No Amusement Rides, Amplified Sound, or Fireworks',
    'Share the space — you do not have sole use, so do not exclude the public',
    'Leave it clean — take all rubbish with you',
    'If any of this changes, go back through the Event Planner — your event may need Council approval',
  ];

  /* Each trigger returns the MINIMUM level it forces, plus a short reason. */
  /* Two attendance figures: the TOTAL across the whole event (expected_attendance) and the
     PEAK on site at one time (peak_attendance). A blank peak falls back to the total. */
  NVC.totalAttendance = function (a) {
    const t = num(a.expected_attendance);
    return t !== null ? t : num(a.peak_attendance);
  };
  NVC.peakAttendance = function (a) {
    const p = num(a.peak_attendance), t = num(a.expected_attendance);
    if (p === null) return t;
    return t === null ? p : Math.min(p, t);
  };
  const bandFor = (n) => (n === null ? null : NVC.TUNE.ATTENDANCE_BANDS.find(b => n >= b.from) || null);

  NVC.LEVEL_TRIGGERS = [
    // Attendance bands (see NVC.TUNE.ATTENDANCE_BANDS above) — measured on PEAK attendance
    function attendance(a) {
      const band = bandFor(NVC.peakAttendance(a));
      return band ? { level: band.level, reason: band.label + (num(a.peak_attendance) !== null ? ' at peak' : '') } : null;
    },
    // Alcohol — first tier that lists a special licence is Level 3
    function alcohol(a) {
      return a.alcohol_served === 'Yes' ? { level: 3, reason: 'Alcohol served' } : null;
    },
    // Traffic condition answer (Traffic & Parking tab mapping)
    function traffic(a) {
      switch (a.traffic_changes) {
        case 'LocalOnly':  return { level: 3, reason: 'Local road impact (TfNSW Class 3/4)' };
        case 'MajorMinor': return { level: 4, reason: 'Major road impact (TfNSW Class 2)' };
        case 'MajorMajor': return { level: 4, reason: 'Major road impact (TfNSW Class 1)' };
        default: return null;
      }
    },
    // Amplified sound tier
    function amplifiedSound(a) {
      if (a.amplified_sound !== 'Yes') return null;
      switch (a.amplification_type) {
        case 'Concert': return { level: 4, reason: 'Concert-level amplified sound' };
        case 'Band':
        case 'DJ':      return { level: 3, reason: 'Full amplified music' };
        case 'PA':      return { level: 2, reason: 'Minor amplified sound (PA)' };
        default:        return { level: 2, reason: 'Amplified sound' };
      }
    },
    // Fireworks (Noise tab fireworks ladder)
    function fireworks(a) {
      if (a.fireworks !== 'Yes') return null;
      if (a.fireworks_criteria === 'Outside') return { level: 4, reason: 'Fireworks outside standard criteria' };
      return { level: 3, reason: 'Fireworks display' };
    },
    // High-risk activities (Entertainment tab → Level 4)
    function highRisk(a) {
      return a.high_risk_activities === 'Yes' ? { level: 4, reason: a.high_risk_type === 'MusicFestival' ? 'Music festival' : 'High-risk activity' } : null;
    },
    // Marquees (Event Levels tab: any marquee ≥100m² → Level 4; any marquee → min Level 2)
    function marquees(a) {
      if (a.marquees_used !== 'Yes') return null;
      const largest = num(a.largest_marquee_area);
      if (largest !== null && largest >= NVC.TUNE.MARQUEE_L4_AREA) return { level: 4, reason: `Single marquee ≥${NVC.TUNE.MARQUEE_L4_AREA}m²` };
      return { level: 2, reason: 'Marquees in use' };
    },
    // Infrastructure — Level 1 asks nothing of Council, so any stage, ride or generator → min Level 2
    function stage(a) {
      return a.stage_used === 'Yes' ? { level: 2, reason: 'Temporary stage / platform' } : null;
    },
    function amusementRides(a) {
      return a.amusement_rides === 'Yes' ? { level: 2, reason: 'Amusement rides / jumping castles' } : null;
    },
    function generators(a) {
      return a.generators_used === 'Yes' ? { level: 2, reason: 'Generators in use' } : null;
    },
    // Multi-day (Event Levels tab → Level 4)
    function multiDay(a) {
      return a.multi_day === 'Yes' ? { level: 4, reason: 'Multi-day event' } : null;
    },
  ];

  /* Compute the running level. Returns { level, drivers:[{level,reason}] } */
  NVC.computeLevel = function (answers) {
    let max = 0;
    const drivers = [];
    for (const trig of NVC.LEVEL_TRIGGERS) {
      const r = trig(answers);
      if (r) {
        drivers.push(r);
        if (r.level > max) max = r.level;
      }
    }
    // Only the drivers that actually set the current max are "the reason we're here"
    const topDrivers = drivers.filter(d => d.level === max);
    // Where the TOTAL falls in a higher band than the level reached, flag it for Council
    const totalBand = bandFor(NVC.totalAttendance(answers));
    const totalLevel = max && totalBand && totalBand.level > max ? totalBand.level : null;
    return { level: max, drivers, topDrivers, totalLevel };
  };

})(window.NVC = window.NVC || {});
