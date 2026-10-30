/* ============================================================
   NOTIFICATION ATTACHMENTS  (§6)
   ES Notification    — trigger: Event Level 3 or 4
   Resident Notification — trigger: Noise Level 2+ OR any road closure
   Police Notification — NOT a doc: it's an action item on Security.

   Contact Person / Phone for send-time is ALWAYS left blank (§6).
   ============================================================ */
(function (NVC) {
  const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };
  const val = (a, id, fallback) => (a[id] !== undefined && a[id] !== '' ? a[id] : (fallback || '—'));

  const trafficLabel = {
    No: 'No', LocalOnly: 'Yes — local roads only', MajorMinor: 'Yes — local & major roads (minor)', MajorMajor: 'Yes — local & major roads (major)',
  };

  const riskLabel = { MusicFestival: 'music festival', Motorsport: 'motorsport', Water: 'water-based activities', Fire: 'fire or pyrotechnic performance', Other: 'other' };

  NVC.NOTIFICATIONS = {
    es: {
      id: 'es', title: 'Emergency Services Notification',
      filename: 'ES-Notification',
      trigger: (a, d) => d.level >= 3,
      purpose: 'A courtesy notification to Emergency Services so they are aware an event is taking place, its scale, and any factors relevant to their planning. This is not a formal approval or licence — it is an information-sharing step. Emergency Services do not need to respond for the event to proceed.',
      recipients: [
        'NSW Police — Local Area Command',
        'NSW Ambulance',
        'Fire and Rescue NSW / NSW Rural Fire Service (site-dependent)',
        'NSW State Emergency Service (SES) — where relevant (e.g. flood-prone or high-risk sites)',
      ],
      fields: (a, d) => [
        ['Event Name', val(a, 'event_name')],
        ['Event Date', val(a, 'event_date')],
        ['Event Times', `${val(a, 'event_start')} – ${val(a, 'event_finish')}`],
        ['Location / Venue', val(a, 'event_location')],
        ['Total Attendance', val(a, 'expected_attendance')],
        ['Peak On Site at One Time', NVC.peakAttendance(a) !== null ? String(NVC.peakAttendance(a)) : '—'],
        ['Road Closures', trafficLabel[a.traffic_changes] || '—'],
        ['Alcohol Served', a.alcohol_served || '—'],
        ['Fireworks', a.fireworks || '—'],
        ['High-Risk Activities', a.high_risk_activities === 'Yes' && riskLabel[a.high_risk_type] ? 'Yes — ' + riskLabel[a.high_risk_type] : (a.high_risk_activities || '—')],
        ['Organiser Contact Name & Phone', [val(a, 'organiser_contact_name'), val(a, 'organiser_contact_phone', '')].filter(Boolean).join(', ') || '—'],
      ],
    },

    resident: {
      id: 'resident', title: 'Resident Notification Letter',
      filename: 'Resident-Notification',
      trigger: (a, d) => d.noiseLevel >= 2 || (a.traffic_changes && a.traffic_changes !== 'No'),
      purpose: 'A notification letter distributed to residents and businesses within the event precinct so they know what to expect and who to contact with concerns.',
      fields: (a, d) => [
        ['Event Name', val(a, 'event_name')],
        ['Event Date', val(a, 'event_date')],
        ['Location', val(a, 'event_location')],
        ['Bump-In / Bump-Out', `set-up from ${val(a, 'bump_in_start')} · pack-down to ${val(a, 'bump_out_finish')}`],
        ['Event Times', `${val(a, 'event_start')} – ${val(a, 'event_finish')}`],
        ['Road Closures / Traffic Changes', trafficLabel[a.traffic_changes] || 'No'],
        ['Likely Disruptions (Noise, Parking)', disruptions(a, d)],
        // §6: this contact field is ALWAYS left blank for manual completion at send-time.
        ['Contact Number for Enquiries', '________________________  (complete at send-time)'],
      ],
    },
  };

  function disruptions(a, d) {
    const bits = [];
    if (d.noiseLevel >= 2) bits.push(`amplified sound${a.amplified_finish ? ' until ' + a.amplified_finish : ''}`);
    if (a.fireworks === 'Yes') bits.push('fireworks');
    if (a.traffic_changes && a.traffic_changes !== 'No') bits.push('road closures / parking changes');
    return bits.length ? bits.join('; ') : 'minor local disruption';
  }

})(window.NVC = window.NVC || {});
