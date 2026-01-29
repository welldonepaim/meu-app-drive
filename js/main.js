"use strict";

// =====================
// Render geral
// =====================
function renderAll(){
  renderKPIs();
  refreshTipoSelect();
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
