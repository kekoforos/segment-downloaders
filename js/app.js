(function () {
  'use strict';

  var STORAGE_KEY = 'stravaSegmentDownloader.segments';
  var GPX_BASE_URL = 'https://www.doogal.co.uk/StravaSegmentGpx/';
  var STRAVA_SEGMENT_URL = 'https://www.strava.com/segments/';

  var segmentListEl = document.getElementById('segment-list');
  var addForm = document.getElementById('add-segment-form');
  var segmentIdInput = document.getElementById('segment-id-input');
  var formMessageEl = document.getElementById('form-message');
  var listMessageEl = document.getElementById('list-message');
  var downloadAllBtn = document.getElementById('download-all-btn');
  var removeAllBtn = document.getElementById('remove-all-btn');
  var segmentFileInput = document.getElementById('segment-file-input');
  var importMessageEl = document.getElementById('import-message');

  var segments = loadSegments();

  function loadSegments() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Migra listados antiguos (array de strings) al formato {id, name}.
      return parsed.map(function (item) {
        return typeof item === 'string' ? { id: item, name: null } : { id: item.id, name: item.name || null };
      });
    } catch (err) {
      return [];
    }
  }

  function saveSegments() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(segments));
  }

  function setMessage(el, text, type) {
    el.textContent = text || '';
    el.classList.remove('error', 'success');
    if (type) {
      el.classList.add(type);
    }
  }

  function buildGpxUrl(segmentId) {
    return GPX_BASE_URL + encodeURIComponent(segmentId);
  }

  function findSegment(segmentId) {
    for (var i = 0; i < segments.length; i += 1) {
      if (segments[i].id === segmentId) {
        return segments[i];
      }
    }
    return null;
  }

  function render() {
    segmentListEl.innerHTML = '';

    segments.forEach(function (segment, index) {
      var segmentId = segment.id;
      var li = document.createElement('li');
      li.className = 'segment-item';
      li.dataset.segmentId = segmentId;

      var info = document.createElement('div');
      info.className = 'segment-info';

      var position = document.createElement('span');
      position.className = 'segment-position';
      position.textContent = (index + 1) + '.';
      info.appendChild(position);

      var badge = document.createElement('a');
      badge.className = 'segment-badge';
      badge.textContent = segmentId;
      badge.href = STRAVA_SEGMENT_URL + encodeURIComponent(segmentId);
      badge.target = '_blank';
      badge.rel = 'noopener noreferrer';
      badge.title = 'Ver segmento en Strava';
      info.appendChild(badge);

      var label = document.createElement('span');
      label.className = 'segment-label';
      label.textContent = segment.name || '';
      if (segment.name) {
        label.title = segment.name;
      }
      info.appendChild(label);

      li.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'segment-actions';

      var downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.textContent = 'Descargar';
      downloadBtn.addEventListener('click', function () {
        downloadSegment(segmentId, li);
      });
      actions.appendChild(downloadBtn);

      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'Eliminar';
      removeBtn.addEventListener('click', function () {
        removeSegment(segmentId);
      });
      actions.appendChild(removeBtn);

      li.appendChild(actions);
      segmentListEl.appendChild(li);
    });
  }

  function updateSegmentLabel(segmentId) {
    var li = segmentListEl.querySelector('[data-segment-id="' + segmentId + '"]');
    var segment = findSegment(segmentId);
    if (!li || !segment) {
      return;
    }
    var label = li.querySelector('.segment-label');
    if (label) {
      label.textContent = segment.name || '';
      if (segment.name) {
        label.title = segment.name;
      }
    }
  }

  function fetchSegmentName(segmentId) {
    return fetch(buildGpxUrl(segmentId))
      .then(function (response) {
        var name = response.ok ? extractSegmentName(response, segmentId) : null;
        if (response.body && response.body.cancel) {
          response.body.cancel();
        }
        return name;
      })
      .then(function (name) {
        var segment = findSegment(segmentId);
        if (segment && name) {
          segment.name = name;
          saveSegments();
          updateSegmentLabel(segmentId);
        }
      })
      .catch(function () {
        // El nombre del segmento es informativo; si falla, se conserva solo el ID.
      });
  }

  function addSegment(rawValue) {
    var value = (rawValue || '').trim();

    if (!value || !/^\d+$/.test(value)) {
      setMessage(formMessageEl, 'Introduce un ID de segmento numérico válido.', 'error');
      return;
    }

    if (findSegment(value)) {
      setMessage(formMessageEl, 'El segmento "' + value + '" ya está en el listado.', 'error');
      return;
    }

    segments.push({ id: value, name: null });
    saveSegments();
    render();
    setMessage(formMessageEl, 'Segmento "' + value + '" añadido.', 'success');
    fetchSegmentName(value);
  }

  function removeSegment(segmentId) {
    segments = segments.filter(function (segment) {
      return segment.id !== segmentId;
    });
    saveSegments();
    render();
  }

  function removeAllSegments() {
    if (segments.length === 0) {
      setMessage(listMessageEl, 'El listado ya está vacío.', 'error');
      return;
    }

    var confirmed = window.confirm('¿Seguro que quieres eliminar los ' + segments.length + ' segmento(s) del listado?');
    if (!confirmed) {
      return;
    }

    segments = [];
    saveSegments();
    render();
    setMessage(listMessageEl, 'Se ha vaciado el listado de segmentos.', 'success');
  }

  function parseSegmentIdsFromText(text) {
    return text
      .split(/\r\n|\r|\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  function importSegmentsFromText(text) {
    var lines = parseSegmentIdsFromText(text);
    var added = [];
    var invalidCount = 0;
    var duplicateCount = 0;
    var seenInFile = {};

    lines.forEach(function (line) {
      if (!/^\d+$/.test(line)) {
        invalidCount += 1;
        return;
      }
      if (seenInFile[line] || findSegment(line)) {
        duplicateCount += 1;
        return;
      }
      seenInFile[line] = true;
      var segment = { id: line, name: null };
      segments.push(segment);
      added.push(segment);
    });

    if (added.length > 0) {
      saveSegments();
      render();
    }

    var parts = [];
    if (added.length > 0) {
      parts.push(added.length + ' segmento(s) importado(s).');
    }
    if (duplicateCount > 0) {
      parts.push(duplicateCount + ' duplicado(s) omitido(s).');
    }
    if (invalidCount > 0) {
      parts.push(invalidCount + ' línea(s) inválida(s) omitida(s).');
    }
    if (parts.length === 0) {
      parts.push('El archivo no contenía IDs de segmento válidos.');
    }

    setMessage(importMessageEl, parts.join(' '), added.length > 0 ? 'success' : 'error');

    added.forEach(function (segment) {
      fetchSegmentName(segment.id);
    });
  }

  function triggerBlobDownload(blob, filename) {
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  function showSegmentMessage(li, message, type) {
    if (!li) {
      return;
    }
    var existing = li.querySelector('.segment-note');
    if (existing) {
      existing.remove();
    }
    if (!message) {
      return;
    }
    var noteEl = document.createElement('span');
    noteEl.className = 'segment-note ' + (type || 'error');
    noteEl.textContent = message;
    li.appendChild(noteEl);
  }

  function triggerDirectDownload(segmentId) {
    // Descarga vía iframe oculto: evita el fetch (y por tanto CORS) dejando que el navegador gestione la petición.
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = buildGpxUrl(segmentId);
    document.body.appendChild(iframe);
    window.setTimeout(function () {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 15000);
  }

  function extractSegmentName(response, segmentId) {
    var disposition = response.headers.get('Content-Disposition') || '';
    var match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    var defaultName = match ? decodeURIComponent(match[1].trim()) : ('segment-' + segmentId + '.gpx');
    return defaultName.replace(/\.gpx$/i, '');
  }

  function downloadSegment(segmentId, li) {
    showSegmentMessage(li, '');

    return fetch(buildGpxUrl(segmentId))
      .then(function (response) {
        if (!response.ok) {
          throw new Error('El servidor respondió con el estado ' + response.status);
        }
        var segmentName = extractSegmentName(response, segmentId);
        return response.blob().then(function (blob) {
          return { blob: blob, segmentName: segmentName };
        });
      })
      .then(function (result) {
        triggerBlobDownload(result.blob, segmentId + ' - ' + result.segmentName + '.gpx');
        var segment = findSegment(segmentId);
        if (segment && !segment.name) {
          segment.name = result.segmentName;
          saveSegments();
          updateSegmentLabel(segmentId);
        }
        return { segmentId: segmentId, ok: true };
      })
      .catch(function (err) {
        // "Failed to fetch" (TypeError) suele indicar un bloqueo CORS del dominio donde está alojada la app;
        // en ese caso se recurre a una descarga directa, que no depende de CORS pero no permite renombrar el archivo.
        if (err instanceof TypeError) {
          triggerDirectDownload(segmentId);
          showSegmentMessage(
            li,
            'Descarga iniciada en modo compatibilidad: el archivo puede conservar el nombre original de doogal.co.uk.',
            'info'
          );
          return { segmentId: segmentId, ok: true, fallback: true };
        }
        showSegmentMessage(li, 'No se pudo descargar el segmento "' + segmentId + '": ' + err.message, 'error');
        return { segmentId: segmentId, ok: false, error: err };
      });
  }

  function downloadAllSegments() {
    setMessage(listMessageEl, '', null);

    if (segments.length === 0) {
      setMessage(listMessageEl, 'El listado está vacío. Añade algún segmento antes de descargar.', 'error');
      return;
    }

    var items = Array.prototype.slice.call(segmentListEl.children);

    var chain = segments.reduce(function (promise, segment, index) {
      return promise.then(function () {
        return downloadSegment(segment.id, items[index]);
      });
    }, Promise.resolve());

    chain.then(function () {
      setMessage(listMessageEl, 'Descarga masiva finalizada.', 'success');
    });
  }

  addForm.addEventListener('submit', function (event) {
    event.preventDefault();
    addSegment(segmentIdInput.value);
    segmentIdInput.value = '';
  });

  downloadAllBtn.addEventListener('click', downloadAllSegments);
  removeAllBtn.addEventListener('click', removeAllSegments);

  segmentFileInput.addEventListener('change', function () {
    var file = segmentFileInput.files && segmentFileInput.files[0];
    segmentFileInput.value = '';
    if (!file) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      importSegmentsFromText(String(reader.result || ''));
    };
    reader.onerror = function () {
      setMessage(importMessageEl, 'No se pudo leer el archivo seleccionado.', 'error');
    };
    reader.readAsText(file);
  });

  render();

  segments.forEach(function (segment) {
    if (!segment.name) {
      fetchSegmentName(segment.id);
    }
  });
})();
