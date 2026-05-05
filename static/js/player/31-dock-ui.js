function initPlayerActionDock() {
  const dockPopup = document.getElementById('dock-popup');
  const dockBackdrop = document.getElementById('dock-backdrop');
  const dockOrbs = document.querySelectorAll('.dock-orb');
  const dpPanes = document.querySelectorAll('.dp-pane');
  const dpTabs = document.querySelectorAll('.dp-tab');
  if (!dockPopup || !dockBackdrop || !dockOrbs.length) return;
  let activePane = null;
  function openPane(name) {
    dpPanes.forEach(p => p.classList.toggle('active', p.id === name));
    dpTabs.forEach(t => t.classList.toggle('active', t.dataset.pane === name));
    dockOrbs.forEach(o => o.classList.toggle('active', o.dataset.pane === name));
    dockPopup.classList.add('open');
    dockBackdrop.classList.add('open');
    activePane = name;
  }
  function closePane() {
    dockPopup.classList.remove('open');
    dockBackdrop.classList.remove('open');
    dockOrbs.forEach(o => o.classList.remove('active'));
    activePane = null;
  }
  dockOrbs.forEach(orb => {
    orb.addEventListener('click', () => {
      const target = orb.dataset.pane;
      if (activePane === target) closePane();
      else openPane(target);
    });
  });
  dpTabs.forEach(tab => tab.addEventListener('click', () => openPane(tab.dataset.pane)));
  dockBackdrop.addEventListener('click', closePane);
  document.querySelector('.dt-clear')?.addEventListener('click', e => {
    e.stopPropagation();
    selectedTargetId = null;
    const info = document.getElementById('selected-target-info');
    const dockTarget = document.getElementById('dock-target');
    if (info) info.style.display = 'none';
    if (dockTarget) dockTarget.style.display = 'none';
    if (typeof renderTableView === 'function') renderTableView();
    if (typeof renderActionMenu === 'function') renderActionMenu();
  });
}

document.addEventListener('DOMContentLoaded', initPlayerActionDock);
