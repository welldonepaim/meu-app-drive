"use strict";

// =====================
// Render geral
// =====================
function renderAll(){
  renderKPIs();
  refreshTipoSelect();
  refreshTipoFilter();
  refreshSetorSelect();
  renderRelatoriosFilters();
  renderTipos();
  renderSetores();
  renderEquipList();
  renderManutList();
  renderOSList();
  renderLogs();
}

renderAll();
