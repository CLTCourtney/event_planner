/* ============================================================
   MASTER INPUT REGISTRY  (native port of the workbook tab)
   De-duplicated question set, grouped into the 6 input
   categories that become the 6 dashboard tiles.

   Field shape:
     id       unique key used in the answers state
     label    question text shown to the organiser
     type     'text' | 'number' | 'date' | 'time' | 'yesno' | 'select'
     options  [{value,label}] for 'select'
     help     optional helper text
     unit     optional suffix shown after number inputs
     required true = counts toward the tile's "complete" state
     gateway  true = a Yes reveals dependent questions
     showIf   fn(answers) => bool  (conditional display)
     isNew    true = field added beyond the original Registry (flagged in brief §7)
   ============================================================ */
(function (NVC) {
  const yes = (a, id) => a[id] === 'Yes';

  // accent = a colour drawn from the Nambucca Valley Council logo, used as the tile's border.
  NVC.CATEGORIES = [
    { id: 'event_details', title: 'Event Details',        accent: '#2E9C79', sub: 'The basics: who, when, where, how many.' },      // green
    { id: 'food_bev',      title: 'Food & Beverage',      accent: '#E23A2C', sub: 'Food, alcohol, water and vendor stalls.' },      // red
    { id: 'temp_struct',   title: 'Temporary Structures', accent: '#F26D0A', sub: 'Marquees, stages and amusement rides.' },        // orange
    { id: 'noise',         title: 'Event Noise',          accent: '#F4B63F', sub: 'Amplified sound, generators, fireworks.' },      // gold/yellow
    { id: 'traffic',       title: 'Traffic & Parking',    accent: '#8CC7F7', sub: 'Road impacts, parking and transport.' },         // light logo-blue (reads on the blue bg)
    { id: 'entertainment', title: 'Entertainment',        accent: '#EF8B2C', sub: 'Copyright, animals, high-risk acts, cash.' },    // warm orange
  ];

  NVC.FIELDS = [
    /* ---------------- EVENT DETAILS ---------------- */
    { cat:'event_details', id:'event_name', label:'Event name', type:'text', required:true, isNew:true,
      help:'Used on your Action Plan and any notifications.' },
    { cat:'event_details', id:'expected_attendance', label:'How many people in total over the whole event?', type:'number', unit:'people', required:true,
      help:'Everyone who comes through across the event, not just those there at one time.' },
    { cat:'event_details', id:'peak_attendance', label:'At the busiest moment, how many will be on site at once?', type:'number', unit:'people', isNew:true,
      help:'Your best estimate. Leave blank if most people stay for the whole event. This sets the Approval Level, toilets, water, first aid, security and parking.',
      hint:(a)=>{ const d = NVC.deriveContext(a); return d.stayHours ? `That means a typical visitor stays about ${NVC.formatHours(d.stayHours)}. Does that sound right?` : null; } },
    { cat:'event_details', id:'event_date', label:'Event date', type:'date', required:true },
    { cat:'event_details', id:'multi_day', label:'Is this a multi-day event?', type:'yesno' },
    { cat:'event_details', id:'event_start', label:'Event start time', type:'time', required:true },
    { cat:'event_details', id:'event_finish', label:'Event finish time', type:'time', required:true },
    { cat:'event_details', id:'event_location', label:'Event location / venue', type:'text', required:true,
      help:'e.g. Coronation Park, Nambucca Heads' },
    { cat:'event_details', id:'site_area_m2', label:'Size of the event site (incl. access points)', type:'number', unit:'m²',
      help:'Used to calculate lighting requirements.' },
    { cat:'event_details', id:'distance_residence_m', label:'Distance to nearest residential property', type:'number', unit:'m',
      help:'Relevant to noise assessment.' },
    { cat:'event_details', id:'bump_in_start', label:'Bump-in start time', type:'time', isNew:true,
      help:'When set-up begins on site. Used for resident notices.' },
    { cat:'event_details', id:'bump_out_finish', label:'Bump-out finish time', type:'time', isNew:true,
      help:'When pack-down is complete (may be after dark).' },
    { cat:'event_details', id:'organiser_contact_name', label:'Organiser contact name', type:'text', isNew:true },
    { cat:'event_details', id:'organiser_contact_phone', label:'Organiser contact phone', type:'text', isNew:true },

    /* ---------------- FOOD & BEVERAGE ---------------- */
    { cat:'food_bev', id:'alcohol_served', label:'Is alcohol being served?', type:'yesno' },
    { cat:'food_bev', id:'food_served', label:'Is food being served?', type:'yesno', gateway:true },
    { cat:'food_bev', id:'food_by_community_group', type:'yesno',
      label:'Is food being served by community/charity groups without a Council Food Licence?',
      showIf:(a)=>yes(a,'food_served') },
    { cat:'food_bev', id:'num_food_vendor_stalls', type:'number', unit:'stalls', isNew:true,
      label:'How many food / vendor stalls will there be?',
      help:'Used to size event power (generators).', showIf:(a)=>yes(a,'food_served') },
    { cat:'food_bev', id:'extra_water_conditions', type:'yesno',
      label:'Will conditions warrant more drinking water (active event or mid-summer)?' },
    { cat:'food_bev', id:'bin_empties', type:'number', unit:'times', isNew:true,
      label:'How many times will bins be emptied during the event?',
      help:'Enter 0 if bins are only emptied afterwards. Each mid-event empty reduces the number of bins needed.' },
    { cat:'food_bev', id:'existing_toilets_used', type:'yesno', gateway:true, isNew:true,
      label:'Will you use existing toilets at the venue?',
      help:'Existing toilets reduce the number you need to bring in. Council is told so cleaning can be scheduled around your event.' },
    { cat:'food_bev', id:'existing_w_wc', type:'number', unit:'toilets', isNew:true, label:'Existing women\'s toilets (WCs)', showIf:(a)=>yes(a,'existing_toilets_used') },
    { cat:'food_bev', id:'existing_w_hb', type:'number', unit:'basins',  isNew:true, label:'Existing women\'s hand basins', showIf:(a)=>yes(a,'existing_toilets_used') },
    { cat:'food_bev', id:'existing_m_wc', type:'number', unit:'toilets', isNew:true, label:'Existing men\'s toilets (WCs)', showIf:(a)=>yes(a,'existing_toilets_used') },
    { cat:'food_bev', id:'existing_m_hb', type:'number', unit:'basins',  isNew:true, label:'Existing men\'s hand basins', showIf:(a)=>yes(a,'existing_toilets_used') },
    { cat:'food_bev', id:'existing_m_ur', type:'number', unit:'urinals', isNew:true, label:'Existing men\'s urinals', showIf:(a)=>yes(a,'existing_toilets_used') },

    /* ---------------- TEMPORARY STRUCTURES ---------------- */
    { cat:'temp_struct', id:'marquees_used', label:'Will marquees / tents be used?', type:'yesno', gateway:true,
      help:'Anything from a 3x3 pop-up through to a large event marquee.' },
    { cat:'temp_struct', id:'total_marquee_area', label:'Total marquee / tent area planned', type:'number', unit:'m²',
      showIf:(a)=>yes(a,'marquees_used') },
    { cat:'temp_struct', id:'largest_marquee_area', label:'Largest single marquee / tent area', type:'number', unit:'m²',
      help:'A single structure over 100m² triggers siting approval + certification.', showIf:(a)=>yes(a,'marquees_used') },
    { cat:'temp_struct', id:'stage_used', label:'Will a temporary stage / platform be used?', type:'yesno', gateway:true },
    { cat:'temp_struct', id:'stage_height', label:'Stage / platform height from the ground', type:'number', unit:'m',
      showIf:(a)=>yes(a,'stage_used') },
    { cat:'temp_struct', id:'stage_area', label:'Stage / platform total floor area', type:'number', unit:'m²',
      showIf:(a)=>yes(a,'stage_used') },
    { cat:'temp_struct', id:'amusement_rides', label:'Will amusement rides / jumping castles be used?', type:'yesno' },

    /* ---------------- EVENT NOISE ---------------- */
    { cat:'noise', id:'amplified_sound', label:'Will amplified sound or music be used?', type:'yesno', gateway:true },
    { cat:'noise', id:'amplification_type', label:'Type of amplification', type:'select', showIf:(a)=>yes(a,'amplified_sound'),
      options:[
        { value:'PA', label:'PA / announcements only' },
        { value:'Band', label:'Live band' },
        { value:'DJ', label:'DJ / electronic' },
        { value:'Concert', label:'Full concert-scale PA' },
      ] },
    { cat:'noise', id:'amplified_finish', label:'Finish time of amplified sound', type:'time', showIf:(a)=>yes(a,'amplified_sound') },
    { cat:'noise', id:'generators_used', label:'Will generators be used?', type:'yesno' },
    { cat:'noise', id:'fireworks', label:'Will fireworks or pyrotechnics be used?', type:'yesno', gateway:true },
    { cat:'noise', id:'fireworks_criteria', label:'Do the fireworks meet the standard criteria?', type:'select',
      help:'Standard = max 10-min display, finishes by 9:30pm, shells ≤4m. Anything beyond this escalates the event to Level 4.',
      showIf:(a)=>yes(a,'fireworks'),
      options:[
        { value:'Standard', label:'Yes — standard display' },
        { value:'Outside',  label:'No — outside standard criteria' },
      ] },

    /* ---------------- TRAFFIC & PARKING ---------------- */
    { cat:'traffic', id:'traffic_changes', label:'Will this event require changes to traffic conditions?', type:'select', required:true,
      options:[
        { value:'No',        label:'No' },
        { value:'LocalOnly', label:'Yes — local roads only impacted' },
        { value:'MajorMinor',label:'Yes — local & major roads impacted (minor way)' },
        { value:'MajorMajor',label:'Yes — local & major roads impacted (major way)' },
      ] },
    { cat:'traffic', id:'car_share_pct', label:'What share of attendees will arrive by car?', type:'number', unit:'%', isNew:true,
      help:'Your own estimate, 0–100. Leave blank to assume everyone drives. Shuttle buses, park-and-ride and walk-up locals all reduce it.' },
    { cat:'traffic', id:'existing_parking_spaces', label:'How many existing public parking spaces are within a 10-minute walk?', type:'number', unit:'spaces', isNew:true,
      help:'Count marked bays in public car parks, plus kerbside space where parking is legal (allow about 6m of kerb per car). Only count spaces likely to be free at event time. Leave blank if unsure.' },
    { cat:'traffic', id:'shuttle_transport', label:'Will shuttle buses or public transport be provided / promoted?', type:'yesno' },
    { cat:'traffic', id:'road_closure_parking', label:'Will the event require road closures affecting on-street parking?', type:'yesno' },
    { cat:'traffic', id:'staff_vendor_parking', label:'Staff, vendors & performers needing separate parking', type:'number', unit:'vehicles' },

    /* ---------------- ENTERTAINMENT ---------------- */
    { cat:'entertainment', id:'copyright_material', label:'Will the event use copyright material (broadcast music / film screening)?', type:'yesno' },
    { cat:'entertainment', id:'animals', label:'Will the event involve animals in any form?', type:'yesno' },
    { cat:'entertainment', id:'high_risk_activities', type:'yesno', gateway:true,
      label:'Will the event involve high-risk activities?',
      help:'A music festival, motorsport, water-based activities, fire performance, or anything else where a serious injury is a realistic possibility. Triggers a medical plan and escalates the event to Level 4.' },
    { cat:'entertainment', id:'high_risk_type', type:'select', isNew:true,
      label:'Which best describes it?',
      help:'Choose the one that carries the most risk. A single-stage event under 5 hours with no more than 2 headline acts and 4 acts in total counts as a concert, not a music festival.',
      showIf:(a)=>yes(a,'high_risk_activities'),
      options:[
        { value:'MusicFestival', label:'Music festival — music or dance focused, several acts, ticketed, 2,000+ people' },
        { value:'Motorsport',    label:'Motorsport' },
        { value:'Water',         label:'Water-based activities' },
        { value:'Fire',          label:'Fire or pyrotechnic performance' },
        { value:'Other',         label:'Other (e.g. VIP attendance, power tools)' },
      ] },
    { cat:'entertainment', id:'cash_onsite', label:'Will the event process significant cash on-site?', type:'yesno' },
  ];

  /* ============================================================
     DEMO EVENTS — ready-made answer sets opened with ?demo=<name> in the address.
     Sample data only; edit freely. (?demo=blank is an empty workspace and needs no entry here.)
     ============================================================ */
  NVC.DEMOS = {
    level1: {
      event_name: 'Valla Beach Community Picnic', expected_attendance: '40',
      event_date: '2026-11-21', multi_day: 'No', event_start: '10:00', event_finish: '13:00',
      event_location: 'Valla Reserve, Valla Beach',
      organiser_contact_name: 'Sample Organiser', organiser_contact_phone: '0400 000 000',
      alcohol_served: 'No', food_served: 'No', extra_water_conditions: 'No', bin_empties: '0', existing_toilets_used: 'No',
      marquees_used: 'No', stage_used: 'No', amusement_rides: 'No',
      amplified_sound: 'No', generators_used: 'No', fireworks: 'No',
      traffic_changes: 'No', shuttle_transport: 'No', road_closure_parking: 'No',
      copyright_material: 'No', animals: 'No', high_risk_activities: 'No', cash_onsite: 'No',
    },
    level3: {
      event_name: 'Bowraville Street Food Festival', expected_attendance: '3500', peak_attendance: '1800',
      event_date: '2027-03-13', multi_day: 'No', event_start: '11:00', event_finish: '20:00',
      event_location: 'High Street, Bowraville', site_area_m2: '6000', distance_residence_m: '40',
      bump_in_start: '06:00', bump_out_finish: '22:00',
      organiser_contact_name: 'Sample Organiser', organiser_contact_phone: '0400 000 000',
      alcohol_served: 'Yes', food_served: 'Yes', food_by_community_group: 'Yes', num_food_vendor_stalls: '20',
      extra_water_conditions: 'No', bin_empties: '1', existing_toilets_used: 'Yes',
      existing_w_wc: '3', existing_w_hb: '2', existing_m_wc: '1', existing_m_hb: '2', existing_m_ur: '2',
      marquees_used: 'Yes', total_marquee_area: '180', largest_marquee_area: '36',
      stage_used: 'Yes', stage_height: '0.9', stage_area: '40', amusement_rides: 'No',
      amplified_sound: 'Yes', amplification_type: 'Band', amplified_finish: '19:30', generators_used: 'Yes', fireworks: 'No',
      traffic_changes: 'LocalOnly', car_share_pct: '65', existing_parking_spaces: '250',
      shuttle_transport: 'No', road_closure_parking: 'Yes', staff_vendor_parking: '40',
      copyright_material: 'Yes', animals: 'No', high_risk_activities: 'No', cash_onsite: 'Yes',
    },
    level4: {
      event_name: 'Nambucca River Festival', expected_attendance: '8000',
      event_date: '2027-05-15', multi_day: 'Yes', event_start: '12:00', event_finish: '23:30',
      event_location: 'Coronation Park, Nambucca Heads', site_area_m2: '40000', distance_residence_m: '150',
      bump_in_start: '07:00', bump_out_finish: '23:59',
      organiser_contact_name: 'Sample Organiser', organiser_contact_phone: '0400 000 000',
      alcohol_served: 'Yes', food_served: 'Yes', food_by_community_group: 'Yes', num_food_vendor_stalls: '40',
      extra_water_conditions: 'Yes', bin_empties: '1', existing_toilets_used: 'No',
      marquees_used: 'Yes', total_marquee_area: '600', largest_marquee_area: '300',
      stage_used: 'Yes', stage_height: '2.5', stage_area: '200', amusement_rides: 'Yes',
      amplified_sound: 'Yes', amplification_type: 'Concert', amplified_finish: '23:00',
      generators_used: 'Yes', fireworks: 'Yes', fireworks_criteria: 'Outside',
      traffic_changes: 'MajorMajor', car_share_pct: '60', existing_parking_spaces: '800',
      shuttle_transport: 'Yes', road_closure_parking: 'Yes', staff_vendor_parking: '150',
      copyright_material: 'Yes', animals: 'Yes', high_risk_activities: 'Yes', high_risk_type: 'MusicFestival',
      cash_onsite: 'Yes',
    },
  };

  /* Helper: fields for a category that are currently visible given answers */
  NVC.visibleFields = function (catId, answers) {
    return NVC.FIELDS.filter(f => f.cat === catId && (!f.showIf || f.showIf(answers)));
  };

  /* Helper: is a category complete? (all currently-visible required fields answered) */
  NVC.categoryStatus = function (catId, answers) {
    const vis = NVC.visibleFields(catId, answers);
    const req = vis.filter(f => f.required);
    const answered = (f) => {
      const v = answers[f.id];
      return v !== undefined && v !== null && v !== '';
    };
    const anyAnswered = vis.some(answered);
    if (req.length) {
      if (req.every(answered)) return 'done';
      return anyAnswered ? 'partial' : 'todo';
    }
    // No required fields: consider "done" once the organiser has visited & answered
    // at least the gateway-level questions, otherwise "todo".
    const gateways = vis.filter(f => !f.showIf);
    if (gateways.length && gateways.every(answered)) return 'done';
    return anyAnswered ? 'partial' : 'todo';
  };

})(window.NVC = window.NVC || {});
