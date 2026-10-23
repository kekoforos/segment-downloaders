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
  var loadingSegmentIds = {};

  function isSegmentLoading(segmentId) {
    return !!loadingSegmentIds[segmentId];
  }

  function setSegmentLoading(segmentId, isLoading) {
    if (isLoading) {
      loadingSegmentIds[segmentId] = true;
    } else {
      delete loadingSegmentIds[segmentId];
    }
  }

  function loadSegments() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Migra listados antiguos (array de strings, o {id, name} sin datos descriptivos) al formato actual.
      return parsed.map(function (item) {
        if (typeof item === 'string') {
          return { id: item, name: null, distance: null, elevationGain: null, averageGrade: null };
        }
        return {
          id: item.id,
          name: item.name || null,
          distance: typeof item.distance === 'number' ? item.distance : null,
          elevationGain: typeof item.elevationGain === 'number' ? item.elevationGain : null,
          averageGrade: typeof item.averageGrade === 'number' ? item.averageGrade : null
        };
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

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function haversineDistanceMeters(a, b) {
    var earthRadiusMeters = 6371000;
    var lat1 = toRadians(a.lat);
    var lat2 = toRadians(b.lat);
    var deltaLat = toRadians(b.lat - a.lat);
    var deltaLon = toRadians(b.lon - a.lon);
    var sinDLat = Math.sin(deltaLat / 2);
    var sinDLon = Math.sin(deltaLon / 2);
    var h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
    var c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return earthRadiusMeters * c;
  }

  function parseGpxDescriptiveData(xmlText) {
    var parser = new DOMParser();
    var xml = parser.parseFromString(xmlText, 'application/xml');
    if (xml.querySelector('parsererror')) {
      return null;
    }

    var trkpts = xml.getElementsByTagName('trkpt');
    if (!trkpts || trkpts.length < 2) {
      return null;
    }

    var points = [];
    for (var i = 0; i < trkpts.length; i += 1) {
      var trkpt = trkpts[i];
      var lat = parseFloat(trkpt.getAttribute('lat'));
      var lon = parseFloat(trkpt.getAttribute('lon'));
      var eleEl = trkpt.getElementsByTagName('ele')[0];
      var ele = eleEl ? parseFloat(eleEl.textContent) : NaN;
      if (!isFinite(lat) || !isFinite(lon) || !isFinite(ele)) {
        // Sin elevación en algún punto no se puede calcular desnivel/pendiente de forma fiable.
        return null;
      }
      points.push({ lat: lat, lon: lon, ele: ele });
    }

    var distanceMeters = 0;
    var elevationGainMeters = 0;
    for (var j = 1; j < points.length; j += 1) {
      distanceMeters += haversineDistanceMeters(points[j - 1], points[j]);
      var eleDiff = points[j].ele - points[j - 1].ele;
      if (eleDiff > 0) {
        elevationGainMeters += eleDiff;
      }
    }

    if (distanceMeters <= 0) {
      return null;
    }

    var averageGrade = Math.round((elevationGainMeters / distanceMeters) * 1000) / 10;

    return {
      distance: Math.round(distanceMeters),
      elevationGain: Math.round(elevationGainMeters),
      averageGrade: averageGrade
    };
  }

  function buildSegmentDescriptionText(segment) {
    if (
      !segment ||
      typeof segment.distance !== 'number' ||
      typeof segment.elevationGain !== 'number' ||
      typeof segment.averageGrade !== 'number'
    ) {
      return null;
    }
    var distanceKm = (segment.distance / 1000).toFixed(1);
    return distanceKm + ' km · ' + segment.elevationGain + ' m D+ · ' + segment.averageGrade.toFixed(1) + '% pendiente media';
  }

  function getSegmentDescriptionDisplay(segmentId, segment) {
    var text = buildSegmentDescriptionText(segment);
    if (text) {
      return { text: text, loading: false };
    }
    if (isSegmentLoading(segmentId)) {
      return { text: 'Cargando datos…', loading: true };
    }
    return null;
  }

  function applyDescriptionDisplay(descriptionEl, display) {
    descriptionEl.textContent = display.text;
    descriptionEl.classList.toggle('segment-description-loading', display.loading);
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

      var textWrap = document.createElement('div');
      textWrap.className = 'segment-text';

      var label = document.createElement('span');
      label.className = 'segment-label';
      label.textContent = segment.name || '';
      if (segment.name) {
        label.title = segment.name;
      }
      textWrap.appendChild(label);

      var descriptionDisplay = getSegmentDescriptionDisplay(segmentId, segment);
      if (descriptionDisplay) {
        var description = document.createElement('span');
        description.className = 'segment-description';
        applyDescriptionDisplay(description, descriptionDisplay);
        textWrap.appendChild(description);
      }

      info.appendChild(textWrap);

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

    var textWrap = li.querySelector('.segment-text');
    var existingDescription = li.querySelector('.segment-description');
    var descriptionDisplay = getSegmentDescriptionDisplay(segmentId, segment);
    if (descriptionDisplay) {
      if (existingDescription) {
        applyDescriptionDisplay(existingDescription, descriptionDisplay);
      } else if (textWrap) {
        var description = document.createElement('span');
        description.className = 'segment-description';
        applyDescriptionDisplay(description, descriptionDisplay);
        textWrap.appendChild(description);
      }
    } else if (existingDescription) {
      existingDescription.remove();
    }
  }

  function fetchSegmentName(segmentId) {
    setSegmentLoading(segmentId, true);
    updateSegmentLabel(segmentId);

    return fetch(buildGpxUrl(segmentId))
      .then(function (response) {
        if (!response.ok) {
          if (response.body && response.body.cancel) {
            response.body.cancel();
          }
          return null;
        }
        var name = extractSegmentName(response, segmentId);
        return response.text().then(function (text) {
          var descriptiveData = null;
          try {
            descriptiveData = parseGpxDescriptiveData(text);
          } catch (err) {
            // Los datos descriptivos son informativos; si el parseo falla, se omiten.
            descriptiveData = null;
          }
          return { name: name, descriptiveData: descriptiveData };
        });
      })
      .then(function (result) {
        var segment = findSegment(segmentId);
        if (!segment || !result) {
          return;
        }
        var changed = false;
        if (result.name) {
          segment.name = result.name;
          changed = true;
        }
        if (result.descriptiveData) {
          segment.distance = result.descriptiveData.distance;
          segment.elevationGain = result.descriptiveData.elevationGain;
          segment.averageGrade = result.descriptiveData.averageGrade;
          changed = true;
        }
        if (changed) {
          saveSegments();
        }
      })
      .catch(function () {
        // El nombre y los datos descriptivos del segmento son informativos; si falla, se conserva solo el ID.
      })
      .finally(function () {
        setSegmentLoading(segmentId, false);
        updateSegmentLabel(segmentId);
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

    segments.push({ id: value, name: null, distance: null, elevationGain: null, averageGrade: null });
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
      var segment = { id: line, name: null, distance: null, elevationGain: null, averageGrade: null };
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
    if (!segment.name || typeof segment.distance !== 'number') {
      fetchSegmentName(segment.id);
    }
  });
})();
