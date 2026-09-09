(() => {
  const origin = window.MINGLE_BACKEND_ORIGIN;
  // One anonymous aggregate event per page load; no cookie, visitor ID or referrer.
  fetch(new URL('/api/visit', origin), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
  const fields = document.querySelectorAll('[data-policy]');
  if (!fields.length) return;
  fetch(new URL('/api/privacy', origin), { credentials: 'omit', cache: 'no-store' })
    .then(response => { if (!response.ok) throw new Error(); return response.json(); })
    .then(policy => {
      for (const node of fields) node.textContent = policy[node.dataset.policy] || 'À compléter par l’exploitant avant l’ouverture publique.';
      const relay = document.getElementById('relayPolicy');
      if (relay) relay.textContent = policy.relayRequired ? 'Le relais est obligatoire : ton interlocuteur ne reçoit pas directement ton IP réseau via la connexion vidéo.' : 'Les connexions directes peuvent révéler ton IP réseau à ton interlocuteur. Le réglage de confidentialité permet d’imposer un relais uniquement lorsqu’il est disponible.';
    })
    .catch(() => { document.getElementById('policyStatus').textContent = 'Les informations actualisées sont indisponibles. Contacte aurorawebsec@gmail.com pour obtenir la politique applicable.'; });
})();
