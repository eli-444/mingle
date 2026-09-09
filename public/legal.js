(() => {
  const origin = window.MINGLE_BACKEND_ORIGIN;
  // One anonymous aggregate event per page load; no cookie, visitor ID or referrer.
  fetch(new URL('/api/visit', origin), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
  const fields = document.querySelectorAll('[data-policy]');
  if (!fields.length) return;
  fetch(new URL('/api/privacy', origin), { credentials: 'omit', cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(policy => {
      for (const node of fields) node.textContent = policy[node.dataset.policy] || 'To be completed by the operator before public launch.';
      const relay = document.getElementById('relayPolicy');
      if (relay) relay.textContent = policy.relayRequired ? 'A relay is required: your partner does not directly receive your network IP through the video connection.' : 'Direct connections may reveal your network IP to your partner. The privacy setting can require a relay only when one is available.';
    })
    .catch(() => { document.getElementById('policyStatus').textContent = 'Current information is unavailable. Contact aurorawebsec@gmail.com for the applicable policy.'; });
})();
