(() => {
  const $ = id => document.getElementById(id);
  let preferences = { hideCountry: false, relayOnly: false, analytics: false }, visitorId = null, policy = null;
  try { const stored = JSON.parse(localStorage.getItem('mingle.preferences') || '{}'); for (const key of Object.keys(preferences)) preferences[key] = stored[key] === true; visitorId = localStorage.getItem('mingle.visitor'); } catch {}
  window.minglePrivacy = { get: () => ({ ...preferences, visitorId }) };
  async function refresh() {
    try {
      const response = await fetch(new URL('/api/privacy', window.MINGLE_BACKEND_ORIGIN), { cache: 'no-store', credentials: 'omit' }); if (!response.ok) throw new Error(); policy = await response.json();
      $('relayOnly').disabled = !policy.relayAvailable || policy.relayRequired;
      $('relayOnly').checked = policy.relayRequired || (policy.relayAvailable && preferences.relayOnly);
      $('relayHint').textContent = policy.relayRequired ? 'A relay is required on this site.' : policy.relayAvailable ? 'This setting takes effect on your next search. The relay can see your connection IP; your partner does not receive it directly.' : 'The relay is not configured yet. Direct video connections may reveal your IP to the other participant.';
      const paragraphs = [
        'Operator: ' + (policy.operator || 'Not provided — site in preparation.') + ' Contact : ' + (policy.contact || 'Not provided.'),
        'Operator address: ' + (policy.address || 'To be completed.') + ' Hosting and transfers: ' + (policy.hosting || 'Not provided — this information must be completed before public launch.'),
        'Your camera, microphone and messages are used for the conversation you request. WebRTC streams are encrypted. Messages are relayed without recording the chat or video. Your partner can record their screen; the site cannot prevent this.',
        'Your IP is used to connect, estimate your country through the hosting provider and prevent abuse. Sessions are stored temporarily in Supabase and expire after 90 seconds without a heartbeat. A report stores the reported person’s IP, estimated country, reason, details, time and technical conversation identifiers. Only authenticated administrators can access reports.',
        'Reports and admin audit log: ' + policy.retentionDays + ' days, followed by automatic deletion. Manual IP bans expire after 1, 7 or 30 days. Any hosting backups must follow the policy published by the operator.',
        'Page views, connections, peak concurrent connections, matches and reports are aggregated daily, without IPs in statistics. Unique visitors are counted only with consent, using a random identifier transformed each month. Statistics cover 13 calendar months. These figures do not represent every actual person.',
        'You can decline or withdraw statistics consent without losing chat access. Withdrawal removes the local identifier and requests deletion of its retained unique visitor entries. Preferences are stored locally to remember your choices. No advertising trackers are installed.',
        'Purposes and intended legal bases: providing the requested conversation; legitimate interests in security, moderation and aggregate usage measurement; consent for optional unique visitor tracking. The operator must validate these bases and safeguards for transfers against its actual operations.',
        'To request access, correction, deletion, restriction or objection where applicable, contact the operator above. They may request only what is necessary to locate your data and verify your request. You can also complain to the CNIL (cnil.fr). An IP alone does not prove a person’s identity.'
      ];
      $('privacyText').replaceChildren(...paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    } catch { $('privacyNotice').textContent = 'Information unavailable. Try again shortly.'; }
  }
  $('privacyOpen').onclick = () => { $('hideCountry').checked = preferences.hideCountry; $('analyticsConsent').checked = preferences.analytics; $('privacyNotice').textContent = ''; $('privacyDialog').showModal(); refresh(); };
  $('privacyForm').onsubmit = event => {
    event.preventDefault();
    const previousId = visitorId;
    preferences = { hideCountry: $('hideCountry').checked, relayOnly: policy?.relayRequired || (policy?.relayAvailable && $('relayOnly').checked) || false, analytics: $('analyticsConsent').checked };
    if (preferences.analytics && !visitorId) visitorId = crypto.randomUUID();
    if (!preferences.analytics) visitorId = null;
    let stored = true;
    try { localStorage.setItem('mingle.preferences', JSON.stringify(preferences)); if (visitorId) localStorage.setItem('mingle.visitor', visitorId); else localStorage.removeItem('mingle.visitor'); } catch { stored = false; }
    window.dispatchEvent(new CustomEvent('privacychange', { detail: { removeId: preferences.analytics ? null : previousId } }));
    $('privacyNotice').textContent = stored ? 'Preferences saved. The relay setting applies to your next search.' : 'Choices applied to this page. Your browser prevents them from being saved.';
  };
})();
