"use strict";

// =====================
// Render geral
// =====================
function renderAll(){
  renderKPIs();
  refreshTipoSelect();
  refreshTipoFilter();
  refreshSetorFilter();
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
