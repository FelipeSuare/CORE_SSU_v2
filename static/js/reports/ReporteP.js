document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════════
    // ESTADO DEL MÓDULO
    // ══════════════════════════════════════════════
    let todosFuncionarios         = [];
    let areaLabel                 = 'RECURSOS HUMANOS';
    let nombreRRHH                = '';
    let funcionarioHistorialActual = null;
    let rangoDesde                = null;
    let rangoHasta                = null;

    // ══════════════════════════════════════════════
    // INICIALIZACIÓN
    // ══════════════════════════════════════════════
    async function init() {
        await cargarPerfil();
        await cargarUnidades();
        await cargarFuncionarios();
    }

    // ══════════════════════════════════════════════
    // PROFILE SWITCHER
    // ══════════════════════════════════════════════
    async function cargarPerfil() {
        try {
            const resp = await fetch('/api/usuario/mi-perfil/');
            const data = await resp.json();
            if (!data.error) {
                window.initProfileSwitcher?.({ roles: data.roles, nombre: data.nombre_completo });
                window.setupProfileToggle?.();
            }
        } catch (e) {
            console.error('Error cargando perfil:', e);
        }
    }

    // ══════════════════════════════════════════════
    // CARGA DE UNIDADES (+ contexto del usuario)
    // ══════════════════════════════════════════════
    async function cargarUnidades() {
        try {
            const res  = await fetch('/api/reportes/personal/unidades/');
            const data = await res.json();
            if (data.error) return;

            areaLabel  = data.area_label  || 'RECURSOS HUMANOS';
            nombreRRHH = data.nombre_rrhh || '';

            const sel = document.getElementById('unidadOrg');
            data.unidades.forEach(u => {
                const opt = document.createElement('option');
                opt.value       = u.id_unidad;
                opt.textContent = u.nombre;
                sel.appendChild(opt);
            });
        } catch (e) {
            console.error('Error cargando unidades:', e);
        }
    }

    // ══════════════════════════════════════════════
    // CARGA DE FUNCIONARIOS DESDE LA API
    // ══════════════════════════════════════════════
    async function cargarFuncionarios(params = {}) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#aaa">
            <i class="material-symbols-outlined" style="vertical-align:middle">hourglass_empty</i> Cargando…
        </td></tr>`;

        const qs = new URLSearchParams(params).toString();
        try {
            const res  = await fetch(`/api/reportes/personal/funcionarios/${qs ? '?' + qs : ''}`);
            const data = await res.json();
            if (data.error) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:#c00">${data.error}</td></tr>`;
                return;
            }
            todosFuncionarios = data.funcionarios;
            actualizarHeadersGestion();
            renderTabla(todosFuncionarios);
        } catch (e) {
            console.error('Error cargando funcionarios:', e);
            document.getElementById('tablaBody').innerHTML =
                `<tr><td colspan="9" style="text-align:center;padding:28px;color:#c00">Error al cargar datos.</td></tr>`;
        }
    }

    // ══════════════════════════════════════════════
    // CABECERAS GESTIÓN
    // ══════════════════════════════════════════════
    function actualizarHeadersGestion() {
        const base = new Date().getFullYear();
        ['thRP1','thRP2','thRP3'].forEach((id, i) => {
            const th = document.getElementById(id);
            if (th) th.textContent = base - i;
        });
    }

    // ══════════════════════════════════════════════
    // RENDERIZAR TABLA
    // ══════════════════════════════════════════════
    function renderTabla(datos) {
        const tbody = document.getElementById('tablaBody');
        tbody.innerHTML = '';

        document.getElementById('totalFuncionarios').textContent =
            `${datos.length} funcionario${datos.length !== 1 ? 's' : ''}`;

        if (datos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#aaa">
                No se encontraron funcionarios con los criterios seleccionados.
            </td></tr>`;
            return;
        }

        datos.forEach(f => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(f.nombre_completo)}</td>
                <td>${esc(f.cargo)}</td>
                <td>${f.fecha_ingreso}</td>
                ${f.gestiones.map((g, i) => celdaGestion(g, i)).join('')}
                ${celdaNegados(f)}
                ${celdaAdeudado(f)}
                <td class="td-accion">
                    <div class="cell-acciones">
                        <button class="btn-planilla" data-cod="${f.cod}" data-action="pdf"
                                title="Generar Acta de Vacaciones PDF">
                            <i class="material-symbols-outlined">picture_as_pdf</i>
                        </button>
                        <button class="btn-planilla btn-planilla-hist" data-cod="${f.cod}" data-action="historial"
                                title="Ver Historial de Solicitudes">
                            <i class="material-symbols-outlined">history</i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function celdaGestion(g, i) {
        const base = new Date().getFullYear();
        const anioMostrar = g.anio !== null ? g.anio : (base - i);
        if (g.dias === 0) {
            return `<td><div class="gestion-cell">
                        <span class="gestion-anio">${anioMostrar}</span>
                        <span class="sin-dias">0</span>
                    </div></td>`;
        }
        return `<td><div class="gestion-cell">
                    <span class="gestion-anio">${anioMostrar}</span>
                    <span class="dias-val">${fmt(g.dias)}</span>
                </div></td>`;
    }

    function celdaNegados(f) {
        if (f.dias_negados <= 0) return `<td><span class="sin-dias">—</span></td>`;
        return `<td>
            <span class="dias-negados-val"
                  title="Registro histórico informativo. Ya repuestos en la gestión más antigua.">
                ${fmt(f.dias_negados)}
            </span>
        </td>`;
    }

    function celdaAdeudado(f) {
        return `<td><span class="dias-total">${fmt(f.dias_adeudados)}</span></td>`;
    }

    // ══════════════════════════════════════════════
    // FILTROS
    // ══════════════════════════════════════════════
    function aplicarFiltros() {
        const params   = {};
        const unidad   = document.getElementById('unidadOrg').value;
        const contrato = document.getElementById('tipoContrato').value;
        const nombre   = document.getElementById('funcionario').value.trim();
        if (unidad)   params.unidad        = unidad;
        if (contrato) params.tipo_contrato = contrato;
        if (nombre)   params.funcionario   = nombre;
        cargarFuncionarios(params);
    }

    document.getElementById('btnBuscar').addEventListener('click', aplicarFiltros);
    document.getElementById('funcionario').addEventListener('keypress', e => {
        if (e.key === 'Enter') aplicarFiltros();
    });
    document.getElementById('btnLimpiar').addEventListener('click', () => {
        document.getElementById('unidadOrg').value   = '';
        document.getElementById('tipoContrato').value = '';
        document.getElementById('funcionario').value  = '';
        cargarFuncionarios();
    });

    // ══════════════════════════════════════════════
    // DELEGACIÓN DE CLICS EN TABLA
    // ══════════════════════════════════════════════
    document.getElementById('tablaBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const cod    = btn.dataset.cod;
        const action = btn.dataset.action;
        const f      = todosFuncionarios.find(x => x.cod === cod);
        if (!f) return;
        if (action === 'pdf')       generarActaPDF(f);
        if (action === 'historial') abrirHistorial(cod);
    });

    // ══════════════════════════════════════════════
    // MODAL HISTORIAL
    // ══════════════════════════════════════════════
    const modalHistorial = document.getElementById('modalHistorial');

    async function abrirHistorial(cod) {
        rangoDesde = null;
        rangoHasta = null;
        document.getElementById('anioDesde').value = '';
        document.getElementById('anioHasta').value = '';
        document.getElementById('histModalNombre').textContent  = '…';
        document.getElementById('histModalCargo').textContent   = '…';
        document.getElementById('histModalIngreso').textContent = '…';
        document.getElementById('histModalSaldo').textContent   = '…';
        document.getElementById('historialContenido').innerHTML =
            `<p style="text-align:center;padding:28px;color:#aaa">Cargando historial…</p>`;
        modalHistorial.classList.add('show');

        try {
            const res  = await fetch(`/api/reportes/personal/historial/?cod=${encodeURIComponent(cod)}`);
            const data = await res.json();
            if (data.error) {
                document.getElementById('historialContenido').innerHTML =
                    `<p style="color:#c00;text-align:center;padding:20px">${data.error}</p>`;
                return;
            }
            funcionarioHistorialActual = data;
            document.getElementById('histModalNombre').textContent  = data.nombre_completo;
            document.getElementById('histModalCargo').textContent   = data.cargo;
            document.getElementById('histModalIngreso').textContent = data.fecha_ingreso;
            document.getElementById('histModalSaldo').textContent   = `${fmt(data.dias_adeudados)} días`;
            renderHistorialContenido(data, null, null);
        } catch (e) {
            console.error('Error cargando historial:', e);
        }
    }

    function renderHistorialContenido(data, desde, hasta) {
        let gestiones = Object.keys(data.historial).sort((a, b) => b - a);

        if (desde !== null || hasta !== null) {
            gestiones = gestiones.filter(g => {
                const anio = parseInt(g);
                return (desde === null || anio >= desde) && (hasta === null || anio <= hasta);
            });
        }

        const contenido = document.getElementById('historialContenido');
        if (gestiones.length === 0) {
            contenido.innerHTML = `<p style="color:#aaa;text-align:center;padding:20px">
                Sin historial para el rango seleccionado.</p>`;
            return;
        }

        contenido.innerHTML = gestiones.map(g => {
            const solicitudes = data.historial[g] || [];
            const filas = solicitudes.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#bbb;padding:12px">Sin solicitudes</td></tr>`
                : solicitudes.map(s => `
                    <tr>
                        <td>${s.nro}</td>
                        <td>${s.inicio}</td>
                        <td>${s.fin}</td>
                        <td>${fmt(s.dias)} día${s.dias !== 1 ? 's' : ''}</td>
                        <td>Aprobada</td>
                    </tr>`).join('');

            return `
                <div class="historial-bloque">
                    <div class="historial-bloque-header">
                        <span class="gest-label">
                            <i class="material-symbols-outlined">calendar_month</i> Gestión ${g}
                        </span>
                        <span class="badge">
                            ${solicitudes.length} solicitud${solicitudes.length !== 1 ? 'es' : ''}
                        </span>
                    </div>
                    <div class="historial-table-wrap">
                        <table class="historial-table">
                            <thead>
                                <tr><th>Nro.</th><th>Inicio</th><th>Fin</th><th>Días</th><th>Estado</th></tr>
                            </thead>
                            <tbody>${filas}</tbody>
                        </table>
                    </div>
                </div>`;
        }).join('');
    }

    document.getElementById('btnAplicarRango').addEventListener('click', () => {
        if (!funcionarioHistorialActual) return;
        const vD = parseInt(document.getElementById('anioDesde').value);
        const vH = parseInt(document.getElementById('anioHasta').value);
        rangoDesde = (!isNaN(vD) && vD >= 2000) ? vD : null;
        rangoHasta = (!isNaN(vH) && vH >= 2000) ? vH : null;

        if (rangoDesde !== null && rangoHasta !== null && rangoDesde > rangoHasta) {
            ['anioDesde', 'anioHasta'].forEach(id => {
                const el = document.getElementById(id);
                el.style.borderColor = 'red';
                setTimeout(() => (el.style.borderColor = ''), 1500);
            });
            return;
        }
        renderHistorialContenido(funcionarioHistorialActual, rangoDesde, rangoHasta);
    });

    document.getElementById('btnLimpiarRango').addEventListener('click', () => {
        if (!funcionarioHistorialActual) return;
        rangoDesde = null;
        rangoHasta = null;
        document.getElementById('anioDesde').value = '';
        document.getElementById('anioHasta').value = '';
        renderHistorialContenido(funcionarioHistorialActual, null, null);
    });

    document.getElementById('closeHistorial').addEventListener('click', () =>
        modalHistorial.classList.remove('show'));
    window.addEventListener('click', e => {
        if (e.target === modalHistorial) modalHistorial.classList.remove('show');
    });

    document.getElementById('btnDescargarHistorial').addEventListener('click', () => {
        if (funcionarioHistorialActual) {
            generarHistorialPDF(funcionarioHistorialActual, rangoDesde, rangoHasta);
        }
    });

    // ══════════════════════════════════════════════
    // PDF: HISTORIAL DE SOLICITUDES
    // ══════════════════════════════════════════════
    function generarHistorialPDF(data, desde, hasta) {
        const hoy       = new Date();
        const fechaStr  = `Trinidad, ${hoy.getDate()} de ${nombreMes(hoy.getMonth())} de ${hoy.getFullYear()}`;
        const rangoLabel = (desde || hasta) ? ` (${desde ?? '…'} – ${hasta ?? '…'})` : '';

        let gestiones = Object.keys(data.historial).sort((a, b) => b - a);
        if (desde !== null || hasta !== null) {
            gestiones = gestiones.filter(g => {
                const anio = parseInt(g);
                return (desde === null || anio >= desde) && (hasta === null || anio <= hasta);
            });
        }

        const bloques = gestiones.map(g => {
            const solicitudes = data.historial[g] || [];
            const filas = solicitudes.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:10px">Sin solicitudes</td></tr>`
                : solicitudes.map(s => `
                    <tr>
                        <td>${s.nro}</td>
                        <td>${s.inicio}</td>
                        <td>${s.fin}</td>
                        <td>${fmt(s.dias)} día${s.dias !== 1 ? 's' : ''}</td>
                        <td>Aprobada</td>
                    </tr>`).join('');
            return `
                <div class="bloque">
                    <div class="bloque-header">
                        <span>Gestión ${g}</span>
                        <span>${solicitudes.length} solicitud${solicitudes.length !== 1 ? 'es' : ''}</span>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Nro.</th><th>Fecha Inicio</th><th>Fecha Fin</th><th>Días</th><th>Estado</th></tr>
                        </thead>
                        <tbody>${filas}</tbody>
                    </table>
                </div>`;
        }).join('');

        abrirVentanaPDF(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Montserrat',Arial,sans-serif;padding:36px 44px;font-size:10px;color:#222;}
    .inst-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;padding-bottom:12px;border-bottom:2px solid rgb(39,20,71);}
    .inst-nombre{font-size:11px;font-weight:700;color:rgb(39,20,71);text-transform:uppercase;line-height:1.5;}
    .inst-fecha{font-size:10px;color:#555;text-align:right;line-height:1.6;}
    .titulo{text-align:center;margin-bottom:20px;}
    .titulo h2{background:rgb(39,20,71);color:#fff;display:inline-block;padding:8px 28px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border-radius:4px;}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;background:#f8f5fb;border:1px solid #ddd;border-radius:6px;padding:12px 18px;margin-bottom:20px;}
    .dato{display:flex;gap:6px;align-items:baseline;}
    .dato-label{font-weight:700;color:rgb(114,0,53);font-size:9px;text-transform:uppercase;min-width:85px;}
    .dato-valor{font-weight:600;color:rgb(39,20,71);font-size:10px;}
    .bloque{margin-bottom:16px;}
    .bloque-header{background:rgb(39,20,71);color:#fff;padding:7px 14px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;font-weight:700;font-size:9.5px;}
    .bloque-header span:last-child{font-weight:400;opacity:0.8;}
    table{width:100%;border-collapse:collapse;font-size:9.5px;}
    thead{background:linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53));}
    thead th{color:#fff;padding:7px 10px;text-align:center;font-weight:700;text-transform:uppercase;border-right:1px solid rgba(255,255,255,.15);}
    thead th:last-child{border-right:none;}
    td{padding:8px 10px;border-bottom:1px solid #f0e6ec;text-align:center;}
    tbody tr:nth-child(even) td{background:#fdf6fa;}
</style></head><body>
    <div class="inst-header">
        <div style="display:flex;align-items:center;gap:14px;">
            <img src="/static/img/login/LOGOSSU.png" style="height:54px;width:auto;">
            <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO<br>
                <span style="font-weight:400;font-size:10px;color:#555">${areaLabel}</span>
            </div>
        </div>
        <div class="inst-fecha">${fechaStr}</div>
    </div>
    <div class="titulo"><h2>HISTORIAL SOLICITUDES${rangoLabel}</h2></div>
    <div class="datos">
        <div class="dato"><span class="dato-label">Funcionario:</span><span class="dato-valor">${data.nombre_completo}</span></div>
        <div class="dato"><span class="dato-label">Cargo:</span><span class="dato-valor">${data.cargo}</span></div>
        <div class="dato"><span class="dato-label">Fecha Ingreso:</span><span class="dato-valor">${data.fecha_ingreso}</span></div>
        <div class="dato"><span class="dato-label">Días disponibles:</span>
            <span class="dato-valor" style="color:rgb(114,0,53)">${fmt(data.dias_adeudados)} días</span></div>
    </div>
    ${bloques}
    <script>window.onload=()=>window.print();<\/script>
</body></html>`);
    }

    // ══════════════════════════════════════════════
    // PDF: ACTA DE VACACIONES
    // ══════════════════════════════════════════════
    function generarActaPDF(f) {
        const hoy      = new Date();
        const dd       = String(hoy.getDate()).padStart(2, '0');
        const mm       = String(hoy.getMonth() + 1).padStart(2, '0');
        const yyyy     = hoy.getFullYear();
        const fechaStr = `TRINIDAD ${dd}/${mm}/${yyyy}`;

        // Solo gestiones con año real (lógica sección 5.2)
        const gestionesReales = f.gestiones.filter(g => g.anio !== null);

        const thsGestion = gestionesReales.map(g =>
            `<th>GESTIÓN<br>${g.anio}</th>`).join('');
        const tdsGestion = gestionesReales.map(g =>
            `<td>${fmt(g.dias)}</td>`).join('');

        const thNeg = f.dias_negados > 0 ? `<th>VACACIONES<br>NEGADAS</th>` : '';
        const tdNeg = f.dias_negados > 0 ? `<td>${fmt(f.dias_negados)}</td>` : '';

        const firmaRRHH = nombreRRHH || 'Encargada de RR.HH.';

        abrirVentanaPDF(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Montserrat',Arial,sans-serif;background:#fff;padding:40px 48px;color:#1a1a1a;font-size:10.5px;}
    .inst-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:14px;border-bottom:2px solid rgb(39,20,71);}
    .inst-nombre{font-size:11px;font-weight:700;color:rgb(39,20,71);text-transform:uppercase;letter-spacing:0.5px;line-height:1.5;}
    .planilla-titulo{text-align:center;margin-bottom:22px;}
    .planilla-titulo h2{background:rgb(39,20,71);color:#fff;display:inline-block;padding:9px 32px;font-size:12.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;border-radius:4px;}
    table{width:100%;border-collapse:collapse;margin-bottom:22px;font-size:10px;}
    thead{background:linear-gradient(90deg,rgb(39,20,71),rgb(114,0,53));}
    th{color:#fff;padding:9px 10px;text-align:center;font-weight:700;font-size:9.5px;text-transform:uppercase;border-right:1px solid rgba(255,255,255,.15);line-height:1.4;}
    th:last-child{border-right:none;}
    td{padding:10px;border-bottom:1px solid #f0e6ec;text-align:center;vertical-align:middle;font-weight:600;}
    tbody tr:nth-child(even) td{background:#fdf6fa;}
    td.td-nombre{text-align:left;font-weight:700;}
    td.td-total{font-size:13px;font-weight:700;color:rgb(114,0,53);background:#f8f5fb;}
    .nota-firma{font-size:9.5px;color:#555;font-style:italic;margin-bottom:16px;line-height:1.6;padding-left:12px;}
    .fecha-acta{font-size:10px;color:#555;text-align:right;margin-bottom:36px;}
    .firmas{display:flex;justify-content:space-between;margin-top:20px;}
    .firma-bloque{width:42%;text-align:center;}
    .firma-linea{border-top:1.5px solid #333;margin-bottom:8px;}
    .firma-nombre{font-weight:700;font-size:10px;text-transform:uppercase;color:rgb(39,20,71);}
    .firma-cargo{font-size:9px;color:#666;margin-top:2px;}
    .firma-rol{font-size:9px;color:rgb(114,0,53);font-weight:600;text-transform:uppercase;margin-top:2px;}
</style></head><body>
    <div class="inst-header">
        <div style="display:flex;align-items:center;gap:14px;">
            <img src="/static/img/login/LOGOSSU.png" style="height:54px;width:auto;">
            <div class="inst-nombre">SEGURO SOCIAL UNIVERSITARIO<br>
                <span style="font-weight:400;font-size:10px;color:#555">${areaLabel}</span>
            </div>
        </div>
        <p class="fecha-acta">${fechaStr}</p>
    </div>
    <div class="planilla-titulo"><h2>VACACIONES PERSONAL</h2></div>
    
    <table>
        <thead>
            <tr>
                <th>APELLIDOS Y NOMBRES</th>
                <th>CARGO</th>
                <th>FECHA DE INGRESO</th>
                ${thsGestion}
                ${thNeg}
                <th>ADEUDADO</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td class="td-nombre">${f.apellidos_nombres}</td>
                <td>${f.cargo}</td>
                <td>${f.fecha_ingreso}</td>
                ${tdsGestion}
                ${tdNeg}
                <td class="td-total">${fmt(f.dias_adeudados)}</td>
            </tr>
        </tbody>
    </table>
    <p class="nota-firma">Firmo la presente planilla estando de acuerdo con el cálculo de vacaciones que se ha realizado hasta la fecha que indica arriba.</p>
    
    <div class="firmas">
        <div class="firma-bloque">
            <div class="firma-linea"></div>
            <div class="firma-nombre">${firmaRRHH}</div>
            <div class="firma-rol">ENCARGADA DE RR.HH</div>
        </div>
        <div class="firma-bloque">
            <div class="firma-linea"></div>
            <div class="firma-nombre">${f.nombre_firma}</div>
            <div class="firma-cargo">${f.cargo}</div>
        </div>
    </div>
    <script>window.onload=()=>window.print();<\/script>
</body></html>`);
    }

    // ══════════════════════════════════════════════
    // UTILIDADES
    // ══════════════════════════════════════════════
    function abrirVentanaPDF(html) {
        const ventana = window.open('', '_blank');
        if (!ventana) {
            alert('El navegador bloqueó la ventana emergente. Permita ventanas emergentes para este sitio e intente de nuevo.');
            return;
        }
        ventana.document.write(html);
        ventana.document.close();
    }

    function fmt(n) {
        return n % 1 === 0 ? String(n) : n.toFixed(1);
    }

    function esc(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function nombreMes(n) {
        return ['enero','febrero','marzo','abril','mayo','junio',
                'julio','agosto','septiembre','octubre','noviembre','diciembre'][n];
    }

    init();
});
