function renderHeader() {
  const site = appData.site || {};
  const selected = appData.selectedCompetition || {};

  if (isHomePage()) {
    setText('siteSubtitle', 'Football results centre');
    setText('competitionTitle', 'Football');
    setText('competitionSubtitle', '');
    setText('regionLabel', '');
    setText('startDate', '');
    setText('endDate', '');
    return;
  }

  const name = selected['Competition Name'] || site.competition || 'Competition';
  const year = selected.Year || site.year || '';
  const logo = selected['Logo URL'] || site.logoUrl || '';

  setText('competitionTitle', name);
  setText('competitionSubtitle', '');
  setText('siteSubtitle', year ? `${name} ${year}` : 'Football results centre');
  setText('regionLabel', '');
  setText('startDate', '');
  setText('endDate', '');

  const scoreboardTitle = $('scoreboardTitle');
  if (scoreboardTitle) scoreboardTitle.textContent = 'Next Up';

  const logoEl = $('competitionLogo');
  if (logoEl && logo) {
    logoEl.src = logo;
    logoEl.alt = `${name} logo`;
  }
}
