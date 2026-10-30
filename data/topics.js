/* ============================================================
   TOPIC RULES  (native port of the 12 workbook topic tabs)
   Each topic:
     id, title
     include(a,d)  -> show this topic in the Action Plan?
     calc(a,d)     -> { headline, escalate?, note? }
     actions       -> [{ text, showIf?(a,d) }]  (non-triggered hidden, §9)
     risks         -> [{ risk, likelihood, consequence, rating, showIf?(a,d) }]
     genReqs       -> [string]
   `d` is the derived context from NVC.deriveContext(a).
   ============================================================ */
(function (NVC) {
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const isYes = (a, id) => a[id] === 'Yes';
  const ceil = Math.ceil;

  /* ============================================================
     POINTS — every ratio, band table and threshold the tool uses.
     This is Council policy. To re-tune a number: change it here,
     save the file, reload the page. Nothing else needs editing.
     (Approval-Level triggers live separately in levels.js -> NVC.TUNE)
     ============================================================ */
  NVC.POINTS = {

    // TRAFFIC & PARKING
    parking: {
      // People per car. 2.7 is Venues NSW's 2022 survey figure for Sydney Football Stadium events
      // (the national all-trips average, ATAP, is 1.7).
      patronsPerCar: 2.7,
    },

    // FOOD & BEVERAGE (drinking water)
    water: {
      // 1 drinking-water point per this many patrons. A guide, from Northern Territory Government
      // public events guidance (1 outlet per 500 people). The workbook's earlier 1 per 150 came from
      // the Building Code of Australia via Wingecarribee Shire Council's guide; whether that applies
      // to outdoor events is for Council's Health and Building team to confirm.
      patronsPerPoint: 500,
    },

    // FIRST AID
    firstAid: {
      ratioStandard: 500,          // 1 first aider per this many attendees
      minWhenOverThreshold: 2,     // minimum first aiders once attendance passes...
      minThreshold: 500,           // ...this attendance (under it = 1 first aider)
    },

    // SECURITY (non-alcohol events only; alcohol defers to Liquor & Gaming)
    security: {
      attendeesPerMarshal: 300,    // 1 security/marshal per this many attendees
      volunteerMaxAttendance: 500, // under this (and no major structures) = volunteers only
    },

    // WASTE — TOILETS  (peak attendance -> fixture count)
    // Source: Safe and Healthy Mass Gatherings (AIDR), as reproduced in the NSW Government
    // Event Starter Guide, which notes there is no uniform Australian standard. Each column is
    // the published band "under N patrons". Below 500 the first column scales down in
    // proportion (minimum 1); at 5,000 and over the last column scales up in proportion —
    // both pro-rata steps are planning assumptions to confirm with Council's Waste team.
    toilets: {
      under: [500, 1000, 2000, 3000, 5000],
      noAlcohol: {
        w_wc: [6, 9, 12, 18, 30],   // Women — WCs
        w_hb: [2, 4, 6, 10, 17],    // Women — hand basins
        m_wc: [1, 2, 4, 6, 8],      // Men — WCs
        m_ur: [2, 4, 8, 15, 25],    // Men — urinals
        m_hb: [2, 4, 6, 10, 17],    // Men — hand basins
      },
      alcohol: {
        w_wc: [13, 16, 18, 22, 40],
        w_hb: [2, 4, 7, 14, 20],
        m_wc: [3, 5, 9, 10, 12],
        m_ur: [8, 10, 15, 20, 30],
        m_hb: [2, 4, 7, 14, 20],
      },
    },

    // WASTE — RUBBISH BINS
    // General waste only (recycling at events is prone to contamination — see General Requirements).
    // Rule of thumb: 1 litre of waste per person per meal (North East Waste, "Developing a
    // Bin Placement Plan"). Bins = litres ÷ bin size ÷ (mid-event empties + 1).
    bins: {
      litresPerPersonPerMeal: 1,
      binLitres: 240,
      mealsShort: 1,               // meal periods for events up to shortEventHours
      mealsLong: 2,                // meal periods for longer events
    },

    // EVENT LENGTH thresholds used by the Waste topics
    wasteDuration: {
      shortEventHours: 4,          // events up to this many hours are "short"
    },

    // POWER
    power: {
      kvaPerStall: 15,             // ~kVA per food/vendor stall
      soundAllowanceByNoiseLevel: { 0: 0, 1: 5, 2: 18, 3: 37, 4: 100 }, // extra kVA by Noise Level
      safetyMargin: 1.25,          // +25% headroom (generators shouldn't run at 100%)
      customAtNoiseLevel: 4,       // Noise Level 4 = Custom Power Plan
    },

    // LIGHTING
    lighting: {
      luxBaseline: 20,             // total lumens = site area (m²) × this lux figure
    },

    // NOISE
    noise: {
      amplificationLevel: { PA: 1, Band: 2, DJ: 2, Concert: 3 }, // amplification type -> Noise Level
      fireworksStandardLevel: 3,   // standard fireworks display -> at least this Noise Level
      fireworksOutsideLevel: 4,    // fireworks outside standard criteria -> this Noise Level
      dbaByLevel: {
        1: '≤55 dBA at nearest residence',
        2: '≤65 dBA at nearest residence',
        3: '72 dBA — on-site measurement required',
        4: 'No fixed ceiling — formal acoustic assessment',
      },
    },

    // TEMPORARY INFRASTRUCTURE (thresholds in metres / m²)
    tempInfra: {
      marqueeCertArea: 100,        // single marquee ≥ this (m²) = siting approval + certification
      stageGuardrailHeight: 1,     // stage over this height (m) needs guardrails
      stageWhsHeight: 2,           // stage over this height (m) needs WHS working-at-height controls
      stageCertArea: 150,          // stage over this floor area (m²) needs certification
      inflatableWhsHeight: 3,      // inflatable platform ≥ this height (m) needs WHS design registration
    },

    // ACCESSIBILITY
    accessibility: {
      pathWidthMm: 1000,           // minimum continuous accessible path width (AS 1428.1)
    },
  };
  const P = NVC.POINTS;

  /* Published toilet band lookup: the first band the attendance falls under, scaled
     pro-rata below the first band and from the last band upward. */
  function toiletBand(att, under, row) {
    const last = under.length - 1;
    if (att < under[0]) return row[0] * att / under[0];
    if (att >= under[last]) return row[last] * att / under[last];
    return row[under.findIndex(u => att < u)];
  }

  /* Parse "HH:MM" -> minutes since midnight, or null. */
  function mins(t) {
    if (!t || typeof t !== 'string' || t.indexOf(':') < 0) return null;
    const [h, m] = t.split(':').map(Number);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }

  /* ---------- Sunset for Nambucca (fixed shire coordinate, §Lighting tab) ---------- */
  const NAMBUCCA_LAT = -30.6417, NAMBUCCA_LNG = 152.9836;
  function isNSWDaylightSaving(date) {
    // NSW DST: first Sunday Oct 02:00 -> first Sunday Apr 03:00
    const y = date.getFullYear();
    const firstSunday = (mo) => { const d = new Date(y, mo, 1); return new Date(y, mo, 1 + ((7 - d.getDay()) % 7)); };
    const start = firstSunday(9);  // October
    const end = firstSunday(3);    // April
    return date >= start || date < end;
  }
  function sunsetMinutes(date) {
    // NOAA sunset approximation -> local Nambucca time in minutes since midnight.
    const rad = Math.PI / 180;
    const dayOfYear = (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      - Date.UTC(date.getFullYear(), 0, 0)) / 86400000;
    const lngHour = NAMBUCCA_LNG / 15;
    const t = dayOfYear + ((18 - lngHour) / 24);         // rising/setting: use 18 for sunset
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
    L = (L + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = (RA + 360) % 360;
    RA += (Math.floor(L / 90) * 90) - (Math.floor(RA / 90) * 90);
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const zenith = 90.833;
    const cosH = (Math.cos(zenith * rad) - (sinDec * Math.sin(NAMBUCCA_LAT * rad)))
      / (cosDec * Math.cos(NAMBUCCA_LAT * rad));
    if (cosH > 1 || cosH < -1) return 18 * 60; // sun never sets/rises — fallback 6pm
    const H = (Math.acos(cosH) / rad) / 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    let UT = (T - lngHour) % 24;
    UT = (UT + 24) % 24;
    const offset = isNSWDaylightSaving(date) ? 11 : 10; // AEDT / AEST
    let local = (UT + offset) % 24;
    return Math.round(local * 60);
  }
  NVC._sunsetMinutes = sunsetMinutes; // exposed for debugging

  /* ---------- Derived context (shared cross-topic values) ---------- */
  NVC.formatHours = function (h) {
    if (h < 1) return `${Math.max(5, Math.round(h * 60 / 5) * 5)} minutes`;
    const r = Math.round(h * 2) / 2;
    return `${r} hour${r === 1 ? '' : 's'}`;
  };

  NVC.deriveContext = function (a) {
    const att = NVC.peakAttendance(a);      // peak on site at one time — drives most figures
    const total = NVC.totalAttendance(a);   // everyone across the event — drives waste
    const alcohol = isYes(a, 'alcohol_served');
    const food = isYes(a, 'food_served');
    const foodOrAlc = food || alcohol;

    // Event duration (hours) from start/finish
    let duration = null;
    const s = mins(a.event_start), f = mins(a.event_finish);
    if (s !== null && f !== null) {
      let diff = f - s; if (diff <= 0) diff += 24 * 60;
      duration = diff / 60;
    }

    // Noise level (amplification + fireworks escalation)
    let noiseLevel = 0;
    if (isYes(a, 'amplified_sound')) {
      noiseLevel = P.noise.amplificationLevel[a.amplification_type] || 1;
    }
    if (isYes(a, 'fireworks')) {
      noiseLevel = Math.max(noiseLevel, a.fireworks_criteria === 'Outside'
        ? P.noise.fireworksOutsideLevel : P.noise.fireworksStandardLevel);
    }

    // "Major structures" flag (drives Security)
    const majorStructures =
      (num(a.largest_marquee_area) >= P.tempInfra.marqueeCertArea) ||
      (num(a.stage_area) > P.tempInfra.stageCertArea) ||
      (num(a.stage_height) > P.tempInfra.stageWhsHeight);

    const level = NVC.computeLevel(a).level;

    // Typical visit length implied by peak ÷ total × event hours (only when the two differ)
    const stayHours = (att !== null && total && duration !== null && att < total) ? att / total * duration : null;

    return { att, total, stayHours, alcohol, food, foodOrAlc, duration, noiseLevel, majorStructures, level };
  };

  const DBA = P.noise.dbaByLevel;
  // Existing venue toilets the organiser will use, or null if none
  const existingToilets = (a) => {
    if (!isYes(a, 'existing_toilets_used')) return null;
    const n = (id) => Math.max(0, Math.floor(num(a[id]) || 0));
    return { wWc: n('existing_w_wc'), wHb: n('existing_w_hb'), mWc: n('existing_m_wc'), mHb: n('existing_m_hb'), mUr: n('existing_m_ur') };
  };
  // Risk rows may carry showIf too, so a risk only appears when it applies to the event
  const alcoholServed = (a) => isYes(a, 'alcohol_served');
  const isOtherRisk = (a) => isYes(a, 'high_risk_activities') && a.high_risk_type === 'Other';
  const isFestival = (a) => isYes(a, 'high_risk_activities') && a.high_risk_type === 'MusicFestival';

  /* ============================================================
     TOPICS
     ============================================================ */
  NVC.TOPICS = [

    /* ---------------- SITE PLAN (Level 2+) ---------------- */
    {
      id: 'site_plan', title: 'Site Plan',
      include: (a, d) => d.level >= 2,
      calc: (a, d) => ({ headline: d.level >= 3
        ? 'To-scale site plan required'
        : 'Hand-marked aerial photo of the site required' }),
      actions: [
        { text: 'Print an aerial photo of the site and mark it up by hand — it does not need to be to scale', showIf: (a, d) => d.level === 2 },
        { text: 'Prepare a to-scale site plan of the event area', showIf: (a, d) => d.level >= 3 },
        { text: 'Mark whichever of these apply: stall locations, first aid stations, amusement devices, emergency exits, emergency vehicle access and egress, and the muster point' },
        { text: 'Show the position of all marquees, stages and amusement rides', showIf: (a) => isYes(a, 'marquees_used') || isYes(a, 'stage_used') || isYes(a, 'amusement_rides') },
        { text: 'Show road closure points and any traffic changes', showIf: (a) => a.traffic_changes && a.traffic_changes !== 'No' },
        { text: 'Show a clear emergency vehicle access route at least 2.5 metres wide', showIf: (a, d) => d.level >= 3 },
        { text: 'Show the distance from amplification / fireworks to the nearest residence', showIf: (a) => isYes(a, 'amplified_sound') || isYes(a, 'fireworks') },
      ],
      risks: [],
      genReqs: [
        'A site plan is required for every event at Approval Level 2 or above. Level 1 events do not need one.',
        'Level 2: a hand-marked aerial photo is acceptable. Levels 3 and 4: the plan must be to scale.',
        'Items that do not apply to your event can be left off the plan.',
      ],
    },

    /* ---------------- ACCESSIBILITY (always) ---------------- */
    {
      id: 'accessibility', title: 'Accessibility',
      include: () => true,
      calc: () => ({ headline: `Minimum continuous accessible path: ${P.accessibility.pathWidthMm.toLocaleString()}mm wide` }),
      actions: [
        { text: 'Confirm a continuous accessible path (min. 1,000mm wide, firm and slip-resistant) connects parking/drop-off to all patron areas' },
        { text: 'Provide a dedicated, unobstructed accessible viewing area at any stage or performance area', showIf: (a) => isYes(a, 'stage_used') || isYes(a, 'amplified_sound') },
        { text: 'Provide a quiet / sensory space for attendees needing a break from crowds or noise' },
        { text: 'Install clear, high-contrast signage using the international symbol of access' },
        { text: 'Arrange a hearing loop or Auslan interpretation for amplified speech / announcements', showIf: (a) => isYes(a, 'amplified_sound') },
      ],
      risks: [
        { risk: 'Path Obstructed or Too Narrow for Wheelchair/Mobility Aid Access', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Uneven/Soft Ground Causing Trips or Wheelchair Difficulty', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Wheelchair Users Unable to See Stage/Performance Area', likelihood: 'Likely', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Sensory Overload for Neurodivergent Attendees (No Quiet Space)', likelihood: 'Possible', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Accessible Toilets Not Reachable via the Accessible Path', likelihood: 'Unlikely', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'The accessible path must be firm, slip-resistant, and free of steps, turnstiles, or other impediments — width alone isn\'t sufficient.',
        'Where two wheelchair users may need to pass, a wider 1,800mm passing space is recommended.',
        'Consider Auslan interpretation or a hearing loop for events with amplified speech/announcements.',
        'This applies to every event regardless of size, duration, or activity type.',
      ],
    },

    /* ---------------- NOISE ---------------- */
    {
      id: 'noise', title: 'Noise',
      include: (a) => isYes(a, 'amplified_sound') || isYes(a, 'fireworks') || isYes(a, 'generators_used'),
      calc: (a, d) => {
        if (!d.noiseLevel) return { headline: 'Noise sources present — assess against POEO "offensive noise" test' };
        return { headline: `Assessed Noise Level ${d.noiseLevel} — ${DBA[d.noiseLevel]}`, escalate: d.noiseLevel >= 3 };
      },
      actions: [
        { text: 'Confirm the applicable dBA limit / assessment requirement with Council' },
        { text: 'Engage an acoustic consultant / commission a Noise Management Plan (Level 4 events)', showIf: (a, d) => d.noiseLevel >= 4 },
        { text: 'Confirm amplified sound and/or fireworks finish time complies with the relevant curfew (incl. the New Year\'s Eve exception if applicable)' },
        { text: 'Complete separate SafeWork NSW notification for fireworks / pyrotechnics', showIf: (a) => isYes(a, 'fireworks') },
        { text: 'Notify nearby residents of event timing, expected noise, and a contact number for complaints' },
      ],
      risks: [
        { risk: 'Noise Complaints from Nearby Residents', likelihood: 'Likely', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Breach of dBA Limit at Nearest Residence', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Curfew Breach (Amplified Sound or Fireworks Running Late)', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Reputational Risk to Council from Non-Compliant Event', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Hearing Damage to Patrons/Staff Near Speakers or Fireworks', likelihood: 'Rare', consequence: 'Major', rating: 'Medium' },
      ],
      genReqs: [
        'Amplified sound within permitted hours is still assessed against the POEO Act\'s general "offensive noise" test.',
        'Level 4 Noise Management Plans should use a background-relative method (e.g. background + 15 dB(A)) rather than a flat figure alone.',
        'Fireworks are regulated by duration and curfew, not dBA, and require separate SafeWork NSW notification.',
        'New Year\'s Eve fireworks/amplified sound may extend beyond the standard curfew, consistent with POEO exceptions.',
      ],
    },

    /* ---------------- TRAFFIC & PARKING (always) ---------------- */
    {
      id: 'traffic', title: 'Traffic & Parking',
      include: () => true,
      calc: (a, d) => {
        const pk = P.parking;
        // Share arriving by car is the organiser's own estimate; blank = everyone drives
        const pct = num(a.car_share_pct);
        const share = pct === null ? 1 : Math.min(100, Math.max(0, pct)) / 100;
        const staff = num(a.staff_vendor_parking) || 0;
        const existing = Math.max(0, num(a.existing_parking_spaces) || 0);
        const cars = d.att !== null ? ceil(d.att * share / pk.patronsPerCar) + staff : null;
        const major = a.traffic_changes === 'MajorMinor' || a.traffic_changes === 'MajorMajor';
        const cls = {
          No: null,
          LocalOnly: 'TfNSW Class 3/4 — 6 weeks lead time',
          MajorMinor: 'TfNSW Class 2 — 3 months lead time',
          MajorMajor: 'TfNSW Class 1 — 6 months lead time',
        }[a.traffic_changes];
        let headline = cars !== null
          ? `About ${cars.toLocaleString()} cars expected (${Math.round(share * 100)}% arriving by car, ${pk.patronsPerCar} people per car${staff ? `, plus ${staff} staff / vendor vehicles` : ''})`
          : 'Enter attendance to estimate parking';
        if (cars !== null && existing) headline += `  ·  ${existing.toLocaleString()} existing spaces nearby — ${cars > existing ? `about ${(cars - existing).toLocaleString()} more to find` : 'enough to cover this'}`;
        if (cls) headline += `  ·  ${cls}`;
        return {
          headline, escalate: major,
          note: major ? 'The parking figure is a starting estimate — parking for an event with major road impacts is settled in your Transport Management Plan.' : undefined,
        };
      },
      actions: [
        { text: 'Confirm where the expected cars will park — on-site, in existing public parking nearby, or at a park-and-ride' },
        { text: 'Confirm shuttle / park-and-ride pick-up points and timetable, and promote them to attendees', showIf: (a) => isYes(a, 'shuttle_transport') },
        { text: 'Confirm the TfNSW Class and lead time for your traffic impact with Council', showIf: (a) => a.traffic_changes && a.traffic_changes !== 'No' },
        { text: 'Engage an RTO-accredited person to design a Traffic Guidance Scheme (TGS) — required at all four Classes', showIf: (a) => a.traffic_changes && a.traffic_changes !== 'No' },
        { text: 'If impacting a State road, apply for a TfNSW Road Occupancy Licence (ROL) via OPLINC at least 10 working days out', showIf: (a) => a.traffic_changes === 'MajorMinor' || a.traffic_changes === 'MajorMajor' },
        { text: 'Confirm whether the event qualifies for the Class 4 Neighbourhood Activity carve-out (non-commercial, resident-organised, Clause 79 Roads Regulation 2018)', showIf: (a) => a.traffic_changes === 'LocalOnly' },
        { text: 'Confirm accessible parking, drop-off/rideshare zones, and staff/vendor parking are planned separately from patron parking' },
      ],
      risks: [
        { risk: 'Insufficient Parking Leading to Overflow onto Unsafe Areas', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Traffic Congestion/Gridlock on Local Roads', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Incorrect Traffic Class Assessment Leading to Non-Compliance', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Pedestrian/Vehicle Conflict at Road Closures or Crossings', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Emergency Vehicle Access Blocked by Event Traffic/Parking', likelihood: 'Rare', consequence: 'Severe', rating: 'High' },
      ],
      genReqs: [
        'There is no set parking ratio for events. The figure above is an estimate of demand, not a Council requirement — confirm it with Council\'s Traffic team.',
        'The estimate uses your own figure for the share of attendees arriving by car. Shuttle buses, park-and-ride and walk-up locals all reduce it.',
        'Existing public parking within walking distance counts toward the estimate — you only need to find the shortfall. Count only spaces likely to be free at event time.',
        'Accessible parking spaces must be provided within the total, not as an addition.',
        'Staff, vendor, and performer parking must be calculated separately and added to the patron-based total.',
        'A Traffic Guidance Scheme (TGS) is required at all four TfNSW Classes and must be designed by an RTO-accredited person — this can\'t be waived regardless of scale.',
      ],
    },

    /* ---------------- FOOD & BEVERAGE (always — incl. water) ---------------- */
    {
      id: 'food_bev', title: 'Food & Beverage',
      include: () => true,
      calc: (a, d) => {
        const per = P.water.patronsPerPoint;
        const water = d.att !== null ? ceil(d.att / per) : null;
        return { headline: water !== null ? `${water} drinking water point(s) to plan for (guide: 1 per ${per} patrons)` : 'Enter attendance to estimate drinking water points' };
      },
      actions: [
        { text: 'Confirm where the drinking water points will be placed' },
        { text: 'Contact Council\'s Health Department regarding Food Business Notification for community/charity food', showIf: (a) => isYes(a, 'food_by_community_group') },
        { text: 'Contact Liquor & Gaming NSW and NSW Police Licensing regarding liquor licence requirements, including the security numbers they require', showIf: (a) => isYes(a, 'alcohol_served') },
        { text: 'Provide additional drinking water points beyond the baseline for hot-weather / active / alcohol-served events', showIf: (a, d) => d.alcohol || isYes(a, 'extra_water_conditions') },
        { text: 'Ensure water points are not used for counterweighting structures — use concrete weights instead' },
      ],
      // Informational blocks shown conditionally (rendered as notes)
      notes: [
        { showIf: (a) => isYes(a, 'food_by_community_group'),
          text: 'Community/Charity food exemption test: a charity/community group selling food for fundraising is exempt from Food Business Notification UNLESS BOTH (1) the food needs temperature control to stay safe, AND (2) it won\'t be eaten immediately after cooking. Exempt: cakes, biscuits, a sausage sizzle eaten immediately. NOT exempt: pre-made refrigerated curries or salads held for later. This is informational — still contact Council\'s Health Department for final advice.' },
        { showIf: (a) => isYes(a, 'alcohol_served'),
          text: 'Alcohol is being served: apply to Liquor & Gaming NSW for a temporary/limited or major-event liquor licence. Service outside standard trading hours or in additional areas requires a licence variation. NSW Police Licensing may require notification for high-risk or large-scale licensed events.' },
      ],
      risks: [
        { risk: 'Food Safety/Contamination Risk from Non-Compliant Vendors', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Alcohol-Related Intoxication or Underage Access', likelihood: 'Likely', consequence: 'Moderate', rating: 'High', showIf: alcoholServed },
        { risk: 'Dehydration/Heat Illness from Insufficient Water Provision', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Unlicensed Food Stall Operating Without Notification', likelihood: 'Unlikely', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Alcohol Service Without Required Licence', likelihood: 'Rare', consequence: 'Severe', rating: 'High', showIf: alcoholServed },
      ],
      genReqs: [
        'Even where exempt from Food Business Notification, a separate s.68 approval is still required to operate a stall on Council land.',
        'The drinking water figure is a guide (1 point per 500 patrons). Some councils apply the Building Code figure of 1 per 150 — confirm with Council\'s Health and Building team.',
        'Free drinking water must be readily available wherever alcohol is sold or supplied (Liquor Regulation 2018).',
        'Water points must not be used for counterweighting structures — use concrete weights instead.',
        'Alcohol service outside standard trading hours or in additional areas requires a variation to the liquor licence.',
        'Hot-weather events and events serving alcohol increase drinking water demand beyond the baseline — consider additional points.',
      ],
    },

    /* ---------------- WASTE — TOILETS (always) ---------------- */
    {
      id: 'waste_toilets', title: 'Waste — Toilets',
      include: () => true,
      calc: (a, d) => {
        if (d.att === null) return { headline: 'Enter attendance to calculate toilet requirements' };
        const rows = d.alcohol ? P.toilets.alcohol : P.toilets.noAlcohol;
        const val = (k) => Math.max(1, ceil(toiletBand(d.att, P.toilets.under, rows[k])));
        const t = { wWc: val('w_wc'), wHb: val('w_hb'), mWc: val('m_wc'), mHb: val('m_hb'), mUr: val('m_ur') };
        const line = (x) => `Women: ${x.wWc} WC + ${x.wHb} basins; Men: ${x.mWc} WC + ${x.mHb} basins + ${x.mUr} urinals`;
        const ex = existingToilets(a);
        if (!ex) return { headline: `Women: ${t.wWc} WC + ${t.wHb} basins  ·  Men: ${t.mWc} WC + ${t.mHb} basins + ${t.mUr} urinals`, table: t };
        // Existing fixtures are taken off like-for-like; a surplus of one type does not offset another
        const bring = {}; Object.keys(t).forEach(k => { bring[k] = Math.max(0, t[k] - ex[k]); });
        const covered = Object.values(bring).every(v => v === 0);
        return {
          headline: `Needed — ${line(t)}  ·  Existing on site — ${line(ex)}  ·  ${covered ? 'Existing toilets cover this — none to bring in' : 'To bring in — ' + line(bring)}`,
          table: t, existing: ex, bring,
        };
      },
      notes: [
        { showIf: (a) => !!existingToilets(a),
          text: (a) => {
            const ex = existingToilets(a);
            const when = [a.event_date, [a.bump_in_start || a.event_start, a.bump_out_finish || a.event_finish].filter(Boolean).join(' – ')].filter(Boolean).join(', ');
            return `For Council: this event will use the venue's existing toilets${when ? ' (' + when + ')' : ''} — Women: ${ex.wWc} WC + ${ex.wHb} basins; Men: ${ex.mWc} WC + ${ex.mHb} basins + ${ex.mUr} urinals. Cleaning and restocking may need to be scheduled before, during and after the event.`;
          } },
      ],
      actions: [
        { text: 'Book any toilets, hand basins & urinals needed beyond those already on-site' },
        { text: 'Tell Council you will be using the venue\'s existing toilets, so cleaning and restocking can be scheduled around the event', showIf: (a) => !!existingToilets(a) },
        { text: 'Arrange pump-out / emptying of portable toilets during the event with the supplier', showIf: (a, d) => (d.duration || 0) > P.wasteDuration.shortEventHours || isYes(a, 'multi_day') },
        { text: 'Arrange accessible/disabled toilet placement directly on the accessible path of travel' },
        { text: 'Schedule regular servicing & restocking (soap, hand towels) during the event' },
        { text: 'Arrange lighting at toilet facilities if the event runs into darkness', showIf: (a, d) => d.lightingRequired },
        { text: 'Arrange post-event removal, wash-down & site restoration' },
      ],
      risks: [
        { risk: 'Toilet Queuing / Overcrowding', likelihood: 'Likely', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Slip/Trip Hazards (Wet Floors, Uneven Ground)', likelihood: 'Possible', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Vandalism/Damage to Facilities', likelihood: 'Rare', consequence: 'Minor', rating: 'Low' },
        { risk: 'Hygiene/Disease Risk from Insufficient Servicing', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Personal Safety Risk Near Facilities After Dark', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
      ],
      genReqs: [
        'Accessible/disabled toilet facilities must be provided regardless of patron numbers.',
        'Toilets must be well lit, provided with soap and hand-drying equipment, and cleaned/restocked regularly.',
        'Toilets must be located away from food storage and food service areas.',
        'Facilities must be suitable for wet weather conditions.',
      ],
      note: 'Figures follow the Safe and Healthy Mass Gatherings guide (AIDR), as reproduced in the NSW Event Starter Guide — there is no uniform Australian standard. They are based on peak attendance, with a higher table where alcohol is available. Figures for events under 500, or 5,000 and over, are scaled in proportion — confirm with Council\'s Waste team.',
    },

    /* ---------------- WASTE — BINS (always) ---------------- */
    {
      id: 'waste_bins', title: 'Waste — Rubbish Bins',
      include: () => true,
      calc: (a, d) => {
        if (d.total === null) return { headline: 'Enter attendance to calculate bin requirements' };
        const b = P.bins;
        // Waste follows everyone who attends. Meals per person follow how long a typical visitor stays.
        const stay = d.stayHours !== null ? d.stayHours : d.duration;
        const meals = (stay !== null && stay > P.wasteDuration.shortEventHours) ? b.mealsLong : b.mealsShort;
        const empties = Math.max(0, Math.floor(num(a.bin_empties) || 0));
        const bins = Math.max(1, ceil(d.total * meals * b.litresPerPersonPerMeal / b.binLitres / (empties + 1)));
        const basis = `${d.total.toLocaleString()} people in total, ${meals} meal period${meals > 1 ? 's' : ''} each, ${empties ? `emptied ${empties} time${empties > 1 ? 's' : ''} during the event` : 'not emptied during the event'}`;
        return { headline: `${bins} × ${b.binLitres}L general waste bins required (${basis})` };
      },
      actions: [
        { text: 'Notify the venue/land manager to empty on-site bins before & after the event' },
        { text: 'Organise additional rubbish bins based on event requirements' },
        { text: 'Book mid-event bin emptying with the venue/land manager or waste contractor', showIf: (a) => (num(a.bin_empties) || 0) > 0 },
        { text: 'Allocate rubbish wardens to keep the event site clean & safe' },
        { text: 'Confirm when bins will be delivered and removed, and who is responsible' },
        { text: 'Mark bin locations and the waste collection point on your site plan', showIf: (a, d) => d.level >= 2 },
        { text: 'Tell stallholders they must take their own waste (packaging, food scraps, cooking oil) away with them', showIf: (a) => isYes(a, 'food_served') },
        { text: 'Arrange post-event clean-up to return the venue/land to its original state' },
      ],
      risks: [
        { risk: 'Rubbish Bin Overflow', likelihood: 'Possible', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Injury such as Needle Stick', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Rubbish Trip Hazards On-Site', likelihood: 'Possible', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Foul Smell From Bins', likelihood: 'Possible', consequence: 'Insignificant', rating: 'Low' },
      ],
      genReqs: [
        'Bins must be provided regardless of event size, even where a formal Event Application is not required.',
        'Place bin stations no more than ~3–14 metres apart in main event areas — beyond this, littering increases.',
        'Position bin stations near toilet facilities, where litter tends to accumulate.',
        'All waste and equipment must be removed and the site left clean and tidy at the conclusion of the event. Fines may apply where an organiser fails to remove event-generated waste.',
        'This is a base general waste plan. Event organisers are encouraged to consider a more detailed waste plan that incorporates the likes of recycling. Contact Council for further information.',
      ],
      note: 'The bin figure is a rule of thumb — 1 litre of waste per person per meal (North East Waste) — with everything going to general waste. Emptying bins during the event reduces the number needed. Food-focused events and events serving alcohol can generate more — confirm with Council\'s Waste team.',
    },

    /* ---------------- FIRST AID (always) ---------------- */
    {
      id: 'first_aid', title: 'First Aid',
      include: () => true,
      calc: (a, d) => {
        const custom = isYes(a, 'high_risk_activities');
        // A music festival's plan is a legal requirement (Music Festivals Act 2019); other high-risk events are Council policy
        const customHead = isFestival(a)
          ? 'Health and Medical Plan required by law (Music Festivals Act 2019)'
          : 'Custom Medical Plan required (high-risk activities) — engage an accredited provider';
        if (d.att === null) return custom ? { headline: customHead, escalate: true } : { headline: 'Enter attendance to calculate first aider requirements' };
        const fa = P.firstAid;
        const ratio = fa.ratioStandard;
        const n = d.att < fa.minThreshold ? 1 : Math.max(fa.minWhenOverThreshold, ceil(d.att / ratio));
        const basis = `1 per ${ratio}${d.att >= fa.minThreshold ? ', min ' + fa.minWhenOverThreshold : ''}`;
        if (custom) return { headline: `${customHead}  ·  Starting estimate — ${n} first aider(s) (${basis})`, escalate: true };
        return { headline: `${n} first aider(s) required (${basis})` };
      },
      actions: [
        { text: 'Engage an accredited provider to prepare a Custom Medical Plan', showIf: (a) => isYes(a, 'high_risk_activities') && !isFestival(a) },
        { text: 'Lodge a Music Festival Early Notification Form with Liquor & Gaming NSW at least 120 days before the event', showIf: isFestival },
        { text: 'Prepare a Health and Medical Plan with your onsite medical provider, using the NSW Health guidelines and template', showIf: isFestival },
        { text: 'If Liquor & Gaming NSW determines the plan must be agreed, submit it to NSW Health at least 60 days before the event', showIf: isFestival },
        { text: 'Engage an accredited first aid/medical provider and confirm AED (defibrillator) availability on-site' },
        { text: 'Arrange rostering/relief coverage for events running longer than a standard shift', showIf: (a, d) => (d.duration || 0) > 6 || isYes(a, 'multi_day') },
        { text: 'Confirm the first aid post location is clearly signed and on the accessible path of travel' },
      ],
      risks: [
        { risk: 'Delayed Response to Medical Emergency', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Alcohol-Related Injury or Intoxication', likelihood: 'Likely', consequence: 'Moderate', rating: 'High', showIf: alcoholServed },
        { risk: 'Heat-Related Illness (Heat Stress/Exhaustion)', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Insufficient First Aider Coverage During Peak Times', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Inadequate Handover Between Shifts (Long/Multi-Day Events)', likelihood: 'Unlikely', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'Every authoritative Australian source favours risk-based assessment over a fixed ratio — treat the number as a starting floor, not a ceiling.',
        'AED (defibrillator) availability should be confirmed regardless of event size.',
        'Every music festival in NSW must prepare and comply with a Health and Medical Plan (Music Festivals Act 2019). Liquor & Gaming NSW determines whether NSW Health must also agree it.',
        'The first aid post should be clearly signed and located on the accessible path of travel.',
        'Long or multi-day events need rostered/relief first aiders rather than a single team covering the whole day.',
      ],
    },

    /* ---------------- SECURITY (always) ---------------- */
    {
      id: 'security', title: 'Security',
      include: () => true,
      calc: (a, d) => {
        if (d.alcohol) return { headline: 'Refer to Liquor & Gaming NSW + NSW Police Licensing — Council sets no ratio for licensed events' };
        if (d.att === null) return { headline: 'Enter attendance to determine security requirements' };
        if (d.att < P.security.volunteerMaxAttendance && !d.majorStructures) return { headline: 'Volunteer marshals sufficient — 0 licensed security required' };
        const n = ceil(d.att / P.security.attendeesPerMarshal);
        return { headline: `${n} security / marshals required (1 per ${P.security.attendeesPerMarshal} attendees)` };
      },
      actions: [
        { text: 'Engage and roster the security / marshals required', showIf: (a, d) => !d.alcohol && d.att !== null && (d.att >= P.security.volunteerMaxAttendance || d.majorStructures) },
        { text: 'Confirm role types match licensing requirements — volunteers must not perform licensed crowd-control duties' },
        { text: 'Prepare and implement a Cash Handling Plan (secure collection/storage, trained staff, regular removal, reconciliation)', showIf: (a) => isYes(a, 'cash_onsite') },
        { text: 'Arrange enhanced security considerations for high-risk activities', showIf: (a) => isYes(a, 'high_risk_activities') },
        { text: 'Complete a NOTICE OF INTENTION TO HOLD A PUBLIC ASSEMBLY (available from www.police.nsw.gov.au) and deliver it to the Commissioner of Police via a local station at least 7 days before the event', showIf: (a, d) => d.level >= 3 },
      ],
      risks: [
        { risk: 'Inadequate Security/Marshal Coverage for Crowd Size', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Volunteers Performing Licensed Security Duties Unlawfully', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Alcohol-Related Crowd Incident Without Licensed Security', likelihood: 'Possible', consequence: 'Severe', rating: 'Extreme', showIf: alcoholServed },
        { risk: 'Unattended Cash Handling Areas', likelihood: 'Unlikely', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Poor Communication Between Security/Volunteer Teams During Incident', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'No NSW or Australian Government ratio exists for event security — Council\'s own baseline applies only where alcohol is not served.',
        'Volunteers must never be asked to check ID, refuse entry, or physically manage conflict — this is a legal requirement, not just a Council preference.',
        'Crowd controllers at licensed events must hold both a security licence and current RSA certification.',
        'Where licensed security is engaged, having both male and female personnel on duty is best practice.',
      ],
    },

    /* ---------------- LIGHTING ---------------- */
    {
      id: 'lighting', title: 'Lighting',
      include: (a, d) => d.lightingRequired || num(a.site_area_m2) !== null,
      calc: (a, d) => {
        if (!d.lightingRequired) return { headline: 'Lighting not required — event finishes before sunset' };
        const area = num(a.site_area_m2);
        if (area === null) return { headline: 'Lighting required (event runs after dark) — enter site area to calculate lumens' };
        const lux = P.lighting.luxBaseline;
        return { headline: `Lighting required — ${(area * lux).toLocaleString()} lumens across the site (${area.toLocaleString()}m² × ${lux} lux)` };
      },
      actions: [
        { text: 'Confirm what lighting is already available on-site and calculate the shortfall to be hired in' },
        { text: 'Arrange higher-level lighting (50–200 lux) for egress routes, work areas, and residential boundaries' },
        { text: 'Confirm lighting placement avoids glare / light spill onto neighbouring properties' },
      ],
      risks: [
        { risk: 'Insufficient Lighting Leading to Patron Trips/Falls', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Inadequate Egress Lighting During Emergency Evacuation', likelihood: 'Unlikely', consequence: 'Severe', rating: 'High' },
        { risk: 'Glare/Light Spill Complaints from Neighbouring Residents', likelihood: 'Likely', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Personal Safety Risk in Poorly Lit Areas (Toilets, Car Parks)', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Equipment Failure (Generator/Lighting Tower) Leaving Site Dark', likelihood: 'Rare', consequence: 'Major', rating: 'Medium' },
      ],
      genReqs: [
        'Council venues may already have permanent lighting installed — the organiser must determine what\'s available and calculate the shortfall.',
        'Egress routes, work areas, and vendor areas require higher lighting (50–200 lux) than the general site baseline.',
        'Sites bordering residential properties must direct/shield fixtures away from neighbouring homes.',
        'Events with an active sport component should use dedicated sports lighting (200–750 lux).',
      ],
    },

    /* ---------------- POWER ---------------- */
    {
      id: 'power', title: 'Power',
      include: (a, d) => (num(a.num_food_vendor_stalls) || 0) > 0 || isYes(a, 'amplified_sound') || isYes(a, 'generators_used'),
      calc: (a, d) => {
        const pw = P.power;
        const custom = d.noiseLevel >= pw.customAtNoiseLevel;
        const customHead = 'Custom Power Plan required (concert-scale / major production)';
        const stalls = num(a.num_food_vendor_stalls) || 0;
        const soundAllow = pw.soundAllowanceByNoiseLevel[d.noiseLevel] || 0;
        const subtotal = stalls * pw.kvaPerStall + soundAllow;
        if (subtotal === 0) return custom ? { headline: customHead, escalate: true } : { headline: 'No significant power load identified — confirm requirements with any hired equipment' };
        const total = Math.round(subtotal * pw.safetyMargin);
        const marginPct = Math.round((pw.safetyMargin - 1) * 100);
        const basis = `${stalls} stalls × ${pw.kvaPerStall} + ${soundAllow} kVA sound, + ${marginPct}% safety margin`;
        if (custom) return { headline: `${customHead}  ·  Starting estimate — ~${total} kVA (${basis})`, escalate: true };
        return { headline: `~${total} kVA required  (${basis})` };
      },
      actions: [
        { text: 'Confirm what power is already available on-site and calculate the shortfall to be hired in (generator)' },
        { text: 'Confirm generator placement avoids noise/exhaust impact on nearby residences and patrons' },
        { text: 'Arrange a backup/standby generator for any critical continuous loads (medical equipment, refrigeration)' },
        { text: 'Confirm all temporary electrical distribution is installed and inspected by a licensed electrician' },
      ],
      risks: [
        { risk: 'Generator Failure Causing Loss of Power to Critical Equipment', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Overloaded Circuit/Generator Leading to Fire Risk', likelihood: 'Unlikely', consequence: 'Severe', rating: 'High' },
        { risk: 'Electric Shock from Poorly Installed Temporary Wiring', likelihood: 'Rare', consequence: 'Severe', rating: 'High' },
        { risk: 'Generator Noise/Exhaust Fumes Affecting Patrons or Residents', likelihood: 'Possible', consequence: 'Minor', rating: 'Medium' },
        { risk: 'Trip Hazard from Exposed Cabling/Cords', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'Council venues may already have power infrastructure installed — the organiser must determine what\'s available and calculate the shortfall.',
        'Generators should not run at 100% capacity continuously — plan for 70–80% of rated capacity as peak load.',
        'kVA = kW ÷ power factor (typically 0.8 for generators) — check supplier specs when converting equipment wattage.',
        'All temporary electrical distribution must be installed and inspected by a licensed electrician.',
      ],
    },

    /* ---------------- TEMPORARY INFRASTRUCTURE ---------------- */
    {
      id: 'temp_infra', title: 'Temporary Infrastructure',
      include: (a) => isYes(a, 'marquees_used') || isYes(a, 'stage_used') || isYes(a, 'amusement_rides'),
      calc: (a) => {
        const ti = P.tempInfra;
        const parts = [];
        if (isYes(a, 'marquees_used')) {
          const largest = num(a.largest_marquee_area);
          parts.push(largest !== null && largest >= ti.marqueeCertArea
            ? `Marquee: siting approval + engineering certification required (single structure ≥${ti.marqueeCertArea}m²)`
            : `Marquee: no single structure ≥${ti.marqueeCertArea}m² (Council may still review cumulative footprint)`);
        }
        if (isYes(a, 'stage_used')) {
          const h = num(a.stage_height), ar = num(a.stage_area);
          const reqs = [];
          if (h !== null && h > ti.stageGuardrailHeight) reqs.push(`guardrails (>${ti.stageGuardrailHeight}m)`);
          if (h !== null && h > ti.stageWhsHeight) reqs.push(`WHS working-at-height controls (>${ti.stageWhsHeight}m)`);
          if (ar !== null && ar > ti.stageCertArea) reqs.push(`siting approval + certification (>${ti.stageCertArea}m²)`);
          parts.push('Stage: ' + (reqs.length ? reqs.join(', ') : 'must be structurally stable, weighted/anchored & risk-assessed'));
        }
        if (isYes(a, 'amusement_rides')) parts.push(`Inflatables: WHS design registration if platform ≥${ti.inflatableWhsHeight}m; wind monitoring plan (anemometer) required`);
        const escalate = num(a.largest_marquee_area) >= ti.marqueeCertArea || num(a.stage_area) > ti.stageCertArea || num(a.stage_height) > ti.stageWhsHeight;
        return { headline: parts.join('  ·  ') || 'Temporary structures in use — confirm certification & anchoring', escalate };
      },
      actions: [
        { text: 'Obtain siting approval & structural certification for any single marquee of 100m² or more', showIf: (a) => isYes(a, 'marquees_used') && !(num(a.largest_marquee_area) !== null && num(a.largest_marquee_area) < P.tempInfra.marqueeCertArea) },
        { text: 'Put in place the stage / platform requirements listed above', showIf: (a) => isYes(a, 'stage_used') },
        { text: 'Arrange inflatable WHS design registration if ≥3m and confirm a wind monitoring plan (anemometer) is in place', showIf: (a) => isYes(a, 'amusement_rides') },
        { text: 'Confirm anchoring method for all structures (marquees weighted not pegged; underground services identified before installation)' },
        { text: 'Arrange structural/engineering sign-off for any roofed stage, marquee, or hoarding given wind loading' },
        { text: 'Confirm public liability insurance and certificates of currency are held for all hired structures' },
      ],
      risks: [
        { risk: 'Structural Collapse of Marquee/Stage/Fencing in High Wind', likelihood: 'Unlikely', consequence: 'Severe', rating: 'High' },
        { risk: 'Fall from Height (Stage/Platform)', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Inflatable Device Failure or Wind-Related Incident', likelihood: 'Rare', consequence: 'Severe', rating: 'High' },
        { risk: 'Crowd/Fencing Barrier Failure Under Pedestrian Load', likelihood: 'Possible', consequence: 'Major', rating: 'High' },
        { risk: 'Fire Egress Obstructed by Temporary Structures', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Non-Compliant/Superseded Certification (e.g. 2007 vs 2022 Fencing Standard)', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'All temporary structures must comply with the ABCB Temporary Structures Standard 2015 and relevant Australian Standards.',
        'Only 2022-certified temporary fencing (AS 4687:2022) should be accepted — a 2007-standard certificate offers no protection under the current standard.',
        'All structures must be weighted/anchored appropriately for the site and season, not just pegged.',
        'Fire egress pathways must be maintained between and within all temporary structures.',
        'Public liability insurance and certificates of currency are required for all hired structures.',
      ],
    },

    /* ---------------- ENTERTAINMENT ---------------- */
    {
      id: 'entertainment', title: 'Entertainment',
      include: (a) => isYes(a, 'copyright_material') || isYes(a, 'animals') || isYes(a, 'high_risk_activities'),
      calc: (a) => {
        const c = [];
        if (isYes(a, 'copyright_material')) c.push('copyright / performance licence');
        if (isYes(a, 'animals')) c.push('DPI exhibited-animals authority');
        if (isYes(a, 'high_risk_activities')) c.push(isOtherRisk(a) ? 'activity risks recorded on the Additional Risks page (Level 4)' : 'activity-specific risk assessment (Level 4)');
        if (isYes(a, 'cash_onsite')) c.push('Cash Handling Plan (see Security)');
        return { headline: 'Conditions apply: ' + c.join(', '), escalate: isYes(a, 'high_risk_activities') };
      },
      actions: [
        { text: 'Confirm APRA AMCOS and PPCA licences are current, or obtain a one-off event licence', showIf: (a) => isYes(a, 'copyright_material') },
        { text: 'Obtain a non-theatrical public screening licence from the film\'s distributor (e.g. Roadshow PPL) or via Screenrights', showIf: (a) => isYes(a, 'copyright_material') },
        { text: 'Confirm any animal exhibitor holds a current DPI authority under the Exhibited Animals Protection Act 1986 (some activities e.g. pony rides may be exempt)', showIf: (a) => isYes(a, 'animals') },
        { text: 'Confirm Council\'s policy that exotic (non-domesticated) animals are not permitted in circus-style exhibitions is met', showIf: (a) => isYes(a, 'animals') },
        { text: 'Commission an activity-specific risk assessment and safety management plan from a suitably qualified provider', showIf: (a) => isYes(a, 'high_risk_activities') && !isOtherRisk(a) },
        { text: 'List the risks of your high-risk activity, and your controls, on the Additional Risks page at the end of this plan', showIf: isOtherRisk },
      ],
      risks: [
        { risk: 'Copyright Infringement from Unlicensed Music/Film Use', likelihood: 'Possible', consequence: 'Moderate', rating: 'Medium' },
        { risk: 'Animal Welfare Incident or Non-Compliant Exhibitor', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Injury from High-Risk Activity', likelihood: 'Possible', consequence: 'Severe', rating: 'Extreme' },
        { risk: 'Cash Theft or Robbery On-Site', likelihood: 'Unlikely', consequence: 'Major', rating: 'Medium' },
        { risk: 'Reputational Damage to Council from Non-Compliant Entertainment', likelihood: 'Unlikely', consequence: 'Moderate', rating: 'Medium' },
      ],
      genReqs: [
        'Public screening/broadcast must be licensed regardless of whether admission is charged — no exemptions by organisation type.',
        'High-risk activities generally escalate the event to Level 4, triggering the Custom Medical Plan (First Aid) and enhanced security considerations.',
        'Not all animal displays require a DPI authority (e.g. pony rides) — but genuine exhibitors (petting zoos, wildlife displays) must hold one.',
        'Significant cash handling on-site triggers a Cash Handling Plan condition, actioned on the Security page.',
      ],
    },

  ];

  /* ============================================================
     COUNCIL DOCUMENTATION CHECKLIST  (page 2 of the Action Plan)
     Only documents that go to Council, or that Council must sight.
     when: 'application' = lodged with the application
           'final'       = issued by a third party close to the event, so may follow,
                           but no later than NVC.TUNE.FINAL_DOCS_DAYS before the event
     An item listed here is not repeated in the topic checklists.
     ============================================================ */
  const trafficChanged = (a) => !!a.traffic_changes && a.traffic_changes !== 'No';
  const majorRoads = (a) => a.traffic_changes === 'MajorMinor' || a.traffic_changes === 'MajorMajor';
  // `short` = a 1–3 word label for the thin documentation column; `text` = the full description (shown on hover).
  NVC.COUNCIL_DOCS = [
    { when: 'application', short: 'Action Plan', text: 'Event Action Plan - This Document' },
    { when: 'application', short: 'Site plan', text: (a, d) => (d.level >= 3 ? 'Site plan, to scale' : 'Site plan — a hand-marked aerial photo') },
    { when: 'application', short: 'Program', text: 'Program of activities' },
    { when: 'application', short: 'Resident notice', text: 'Draft Resident Notification Letter, for Council approval before you distribute it', showIf: (a, d) => NVC.NOTIFICATIONS.resident.trigger(a, d) },
    { when: 'application', short: 'Traffic scheme', text: 'Traffic Guidance Scheme, designed by an RTO-accredited person', showIf: trafficChanged },
    { when: 'application', short: 'Transport plan', text: 'Transport Management Plan', showIf: majorRoads },
    { when: 'application', short: 'Noise plan', text: 'Noise Management Plan', showIf: (a, d) => d.noiseLevel >= 4 },
    { when: 'final', short: 'Insurance', text: 'Public liability insurance certificate of currency — $20 million minimum, naming the event and noting Nambucca Valley Council as an interested party' },
    { when: 'final', short: 'Risk assessment', text: 'Final risk assessment — the risk tables in this plan, with your controls and any additional risks filled in' },
    // The "Other" high-risk type has no specialist provider, so its risks go on the Additional Risks page instead
    { when: 'final', short: 'Activity risk plan', text: 'Activity-specific risk assessment and safety management plan for the high-risk activity', showIf: (a) => isYes(a, 'high_risk_activities') && !isOtherRisk(a) },
    { when: 'final', short: 'Public assembly', text: 'Copy of your Notice of Intention to Hold a Public Assembly, as lodged with NSW Police', showIf: (a, d) => d.level >= 3 },
    { when: 'final', short: 'Liquor licence', text: 'Copy of the liquor licence', showIf: (a) => isYes(a, 'alcohol_served') },
    { when: 'final', short: 'Food vendors', text: 'Food vendors\' food business notifications or inspection reports', showIf: (a) => isYes(a, 'food_served') },
    { when: 'final', short: 'Amusement ride', text: 'Amusement ride operator\'s certificate of currency', showIf: (a) => isYes(a, 'amusement_rides') },
    { when: 'final', short: 'Fireworks certs', text: 'Fireworks operator\'s public liability certificate and SafeWork NSW certificate', showIf: (a) => isYes(a, 'fireworks') },
    { when: 'final', short: 'Structure cert', text: 'Structural / engineering certification for any marquee of 100m² or more, or stage over 150m²',
      showIf: (a) => (isYes(a, 'marquees_used') && num(a.largest_marquee_area) >= P.tempInfra.marqueeCertArea) || (isYes(a, 'stage_used') && num(a.stage_area) > P.tempInfra.stageCertArea) },
    { when: 'final', short: 'Traffic controllers', text: 'Proof of accreditation for your traffic controllers', showIf: trafficChanged },
    { when: 'final', short: 'Road licence', text: 'Copy of the Transport for NSW Road Occupancy Licence', showIf: majorRoads },
    { when: 'final', short: 'Medical plan', text: 'Custom Medical Plan from your medical provider', showIf: (a) => isYes(a, 'high_risk_activities') && !isFestival(a) },
  ];

  const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  function backBusinessDays(dt, n) {
    const r = new Date(dt);
    while (n > 0) { r.setDate(r.getDate() - 1); if (r.getDay() !== 0 && r.getDay() !== 6) n--; }
    return r;
  }
  function backMonths(dt, n) {
    const r = new Date(dt.getFullYear(), dt.getMonth() - n, 1);
    const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(dt.getDate(), lastDay));
    return r;
  }
  NVC.formatDate = (dt) => dt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  /* Returns null at Level 1 (no engagement with Council), otherwise
     { groups: [{ title, dueText, overdue, items: [text] }] } — one group at Level 2, two at Levels 3–4.
     Each group starts its own page and carries a status bubble: green while the date is ahead, red once passed. */
  NVC.councilChecklist = function (a, d, today) {
    const lead = NVC.TUNE.APPLICATION_LEAD[d.level];
    if (!lead) return null;
    const docs = NVC.COUNCIL_DOCS.filter(x => !x.showIf || x.showIf(a, d))
      .map(x => ({ when: x.when, text: typeof x.text === 'function' ? x.text(a, d) : x.text }));
    const event = a.event_date ? new Date(a.event_date + 'T00:00:00') : null;
    const valid = event && !isNaN(event);
    const now = startOfDay(today || new Date());
    const group = (title, due, basis, items) => ({
      title, items,
      dueText: valid ? `Due By ${NVC.formatDate(due)}` : `Due ${basis} before the event`,
      overdue: valid ? now > due : false,
    });
    const appDue = valid ? (lead.businessDays ? backBusinessDays(event, lead.businessDays) : backMonths(event, lead.months)) : null;
    const finalDue = valid ? new Date(event.getFullYear(), event.getMonth(), event.getDate() - NVC.TUNE.FINAL_DOCS_DAYS) : null;
    const only = (w) => docs.filter(x => x.when === w).map(x => x.text);
    // Where the application is due no earlier than the final documents (Level 2), everything goes in together
    if (lead.businessDays || (valid && appDue >= finalDue)) {
      return { groups: [group('Initial Documents', appDue, lead.label, docs.map(x => x.text))] };
    }
    return { groups: [
      group('Initial Documents', appDue, lead.label, only('application')),
      group('Final Documents', finalDue, `${NVC.TUNE.FINAL_DOCS_DAYS} days`, only('final')),
    ] };
  };

  // Signed business days from `from` to `due` (0 = due today, negative = overdue).
  function businessDaysUntil(due, from) {
    const a0 = startOfDay(from), b0 = startOfDay(due);
    if (+a0 === +b0) return 0;
    const sign = b0 > a0 ? 1 : -1;
    let count = 0; const r = new Date(a0);
    while (+r !== +b0) { r.setDate(r.getDate() + sign); const dow = r.getDay(); if (dow !== 0 && dow !== 6) count += sign; }
    return count;
  }

  /* Flat list of the Council documents that apply, for the live Documentation pane.
     Reuses the same due dates as the checklist: application docs by APPLICATION_LEAD,
     final docs by FINAL_DOCS_DAYS before the event (merged into one date at Level 2).
     Returns { applicable, level, valid, items:[{id,text,when,dueDate,daysUntil,status}] }
     status: 'overdue' | 'soon' | 'ok'  (|'none' when no event date yet). */
  NVC.docTracker = function (a, d, today) {
    const lead = NVC.TUNE.APPLICATION_LEAD[d.level];
    if (!lead) return { applicable: false, level: d.level, valid: false, items: [] };
    const event = a.event_date ? new Date(a.event_date + 'T00:00:00') : null;
    const valid = !!(event && !isNaN(event));
    const now = startOfDay(today || new Date());
    const appDue = valid ? (lead.businessDays ? backBusinessDays(event, lead.businessDays) : backMonths(event, lead.months)) : null;
    const finalDue = valid ? new Date(event.getFullYear(), event.getMonth(), event.getDate() - NVC.TUNE.FINAL_DOCS_DAYS) : null;
    const merged = !!(lead.businessDays || (valid && appDue >= finalDue));  // Level 2: one due date for all
    const green = NVC.TUNE.DOC_GREEN_DAYS;
    const items = NVC.COUNCIL_DOCS
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => !x.showIf || x.showIf(a, d))
      .map(({ x, i }) => {
        const due = (merged || x.when === 'application') ? appDue : finalDue;
        let daysUntil = null, status = 'none';
        if (valid) {
          daysUntil = businessDaysUntil(due, now);
          status = daysUntil < 0 ? 'overdue' : (daysUntil < green ? 'soon' : 'ok');
        }
        return { id: 'doc' + i, short: x.short, text: typeof x.text === 'function' ? x.text(a, d) : x.text, when: x.when, dueDate: due, daysUntil: daysUntil, status: status };
      });
    items.sort((p, q) => {                       // soonest due first; undated last
      if (p.dueDate && q.dueDate) return p.dueDate - q.dueDate;
      if (p.dueDate) return -1; if (q.dueDate) return 1; return 0;
    });
    return { applicable: true, level: d.level, valid: valid, items: items };
  };

  /* ============================================================
     RISK RATING MATRIX  (workbook RISK ASSESSMENT tab)
     rows = likelihood, columns = consequence
     ============================================================ */
  NVC.RISK_MATRIX = {
    consequences: ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe'],
    rows: [
      ['Rare',           ['Low', 'Low', 'Low', 'Medium', 'High']],
      ['Unlikely',       ['Low', 'Low', 'Medium', 'Medium', 'High']],
      ['Possible',       ['Low', 'Medium', 'Medium', 'High', 'Extreme']],
      ['Likely',         ['Medium', 'Medium', 'High', 'High', 'Extreme']],
      ['Almost Certain', ['Medium', 'High', 'High', 'Extreme', 'Extreme']],
    ],
  };
  NVC.EXTRA_RISK_ROWS = 7;   // blank rows on the Additional Risks page (sized to fit one A4 page with the matrix)

  /* Second pass: some topic includes need lightingRequired in context. */
  NVC.deriveContextFull = function (a) {
    const d = NVC.deriveContext(a);
    // lighting required?
    let lightingRequired = false;
    if (a.event_date) {
      const dt = new Date(a.event_date + 'T00:00:00');
      if (!isNaN(dt)) {
        const finishes = ['event_finish', 'amplified_finish', 'bump_out_finish']
          .map(id => mins(a[id])).filter(v => v !== null);
        if (finishes.length) {
          const latest = Math.max(...finishes);
          lightingRequired = latest > sunsetMinutes(dt);
        }
      }
    }
    d.lightingRequired = lightingRequired;
    return d;
  };

})(window.NVC = window.NVC || {});
