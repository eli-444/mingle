(() => {
  const $ = id => document.getElementById(id);
  let preferences = { hideCountry: false, relayOnly: false, analytics: false }, visitorId = null, policy = null;
  try { const stored = JSON.parse(localStorage.getItem('mingle.preferences') || '{}'); for (const key of Object.keys(preferences)) preferences[key] = stored[key] === true; visitorId = localStorage.getItem('mingle.visitor'); } catch {}
  window.minglePrivacy = { get: () => ({ ...preferences, visitorId }) };
  async function refresh() {
    try {
      const response = await fetch('/api/privacy', { cache: 'no-store' }); if (!response.ok) throw new Error(); policy = await response.json();
      $('relayOnly').disabled = !policy.relayAvailable || policy.relayRequired;
      $('relayOnly').checked = policy.relayRequired || (policy.relayAvailable && preferences.relayOnly);
      $('relayHint').textContent = policy.relayRequired ? 'Le relais est obligatoire sur ce site.' : policy.relayAvailable ? 'Ce réglage prendra effet à la prochaine recherche. Le relais voit ton IP de connexion, ton interlocuteur ne la reçoit pas directement.' : 'Le relais n’est pas encore configuré. Les connexions vidéo directes peuvent révéler ton IP à l’autre participant.';
      const paragraphs = [
        'Exploitant : ' + (policy.operator || 'Non renseigné — site en préparation.') + ' Contact : ' + (policy.contact || 'Non renseigné.'),
        'Hébergement et transferts : ' + (policy.hosting || 'Non renseignés — ces informations doivent être complétées avant ouverture publique.'),
        'Caméra, micro et messages servent à la conversation demandée. Les flux WebRTC sont chiffrés. Le serveur relaie les messages sans enregistrer le chat ni la vidéo. Ton interlocuteur peut enregistrer son écran ; le site ne peut pas l’empêcher.',
        'L’adresse IP sert à la connexion, à une estimation locale du pays et à la prévention des abus. En cas de signalement, l’IP de la personne signalée, son pays estimé, le motif, les détails, l’heure et des identifiants techniques de conversation sont enregistrés. Seule l’administration authentifiée y accède.',
        'Signalements et journal admin : ' + policy.retentionDays + ' jours maximum, avec suppression automatique. Les blocages IP décidés manuellement expirent après 1, 7 ou 30 jours. Les sauvegardes éventuelles de l’hébergeur doivent suivre la politique annoncée par l’exploitant.',
        'Les compteurs de connexions, duos et signalements sont agrégés par jour, sans IP dans les statistiques. Les visiteurs distincts sont mesurés uniquement sur accord, avec un identifiant aléatoire transformé chaque mois. Les données statistiques sont conservées sur 13 mois calendaires. Ces chiffres ne représentent pas toutes les personnes réelles.',
        'Tu peux refuser ou retirer les statistiques sans perdre l’accès au chat. Le retrait supprime l’identifiant local et demande l’effacement de ses décomptes distincts encore conservés. Les préférences sont stockées localement pour mémoriser tes choix. Aucun outil publicitaire n’est installé.',
        'Finalités et bases envisagées : fourniture de la conversation demandée ; intérêt légitime à sécuriser et modérer le service et à mesurer son activité agrégée ; consentement pour le suivi facultatif des visiteurs distincts. L’exploitant doit valider ces bases et l’encadrement des transferts au regard de son exploitation effective.',
        'Pour demander l’accès, la rectification, l’effacement, la limitation ou exercer une opposition selon ta situation, contacte l’exploitant indiqué ci-dessus. Il pourra demander les éléments strictement nécessaires pour retrouver les données et vérifier ta demande. Tu peux aussi déposer une réclamation auprès de la CNIL (cnil.fr). Une IP seule ne prouve pas l’identité d’une personne.'
      ];
      $('privacyText').replaceChildren(...paragraphs.map(text => { const p = document.createElement('p'); p.textContent = text; return p; }));
    } catch { $('privacyNotice').textContent = 'Informations indisponibles. Réessaie dans un instant.'; }
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
    $('privacyNotice').textContent = stored ? 'Préférences enregistrées. Le réglage du relais s’applique à la prochaine recherche.' : 'Choix appliqués à cette page. Ton navigateur empêche leur mémorisation.';
  };
})();
