/**
 * Îlot d'interface.
 *
 * Le thread principal ne parse rien et n'écrit rien : il passe des octets au
 * worker et affiche ce qui revient. Tout ce qui coûte est de l'autre côté.
 */
import { downloadZip } from 'client-zip';
import { parseCoordinates, formatDecimal, formatDms, distanceMetres, formatDistance } from '../exif/coords.ts';
import type { FromWorker, LatLon, PhotoRead, ToWorker, WriteResult } from '../exif/types.ts';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const el = {
  picker: $<HTMLInputElement>('picker'),
  vide: $('etat-vide'),
  actif: $('etat-actif'),
  etapes: $('etapes'),
  nom: $('nom-fichier'),
  pillFormat: $('pill-format'),
  pillPosition: $('pill-position'),
  changer: $<HTMLButtonElement>('changer'),
  coords: $<HTMLInputElement>('coords'),
  resultat: $('resultat'),
  resultatCoords: $('resultat-coords'),
  resultatDetail: $('resultat-detail'),
  telecharger: $<HTMLButtonElement>('telecharger'),
  effacer: $<HTMLButtonElement>('effacer'),
  effacerTout: $<HTMLButtonElement>('effacer-tout'),
  autres: $<HTMLDetailsElement>('autres'),
  autresListe: $('autres-liste'),
  alerteFormat: $('alerte-format'),
  lot: $('lot'),
  lotResume: $('lot-resume'),
  lotListe: $('lot-liste'),
  annonce: $('annonce'),
};

interface Item {
  id: string;
  file: File;
  read?: PhotoRead;
  erreur?: string;
}

const items: Item[] = [];
let principal: Item | null = null;
let cible: LatLon | null = null;
let compteur = 0;

/* --- worker ------------------------------------------------------- */

let worker: Worker | null = null;
const enAttente = new Map<string, (m: FromWorker) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../worker/exif.worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    const id = m.type === 'apply:done' ? m.payload.id : m.type === 'read:ok' ? m.payload.id : m.id;
    const resolve = enAttente.get(id);
    if (resolve) {
      enAttente.delete(id);
      resolve(m);
    }
  });
  return worker;
}

function demander(message: ToWorker, transfer: Transferable[]): Promise<FromWorker> {
  return new Promise((resolve) => {
    enAttente.set(message.id, resolve);
    getWorker().postMessage(message, transfer);
  });
}

/* --- annonces ----------------------------------------------------- */

function annoncer(texte: string): void {
  el.annonce.textContent = texte;
}

/* --- état --------------------------------------------------------- */

function marquerEtape(n: 1 | 2 | 3): void {
  for (const li of Array.from(el.etapes.children) as HTMLElement[]) {
    const e = Number(li.dataset.etape);
    li.classList.toggle('done', e < n);
    li.classList.toggle('on', e === n);
    if (e < n) {
      const no = li.querySelector('.no');
      if (no) no.textContent = '✓';
    } else {
      const no = li.querySelector('.no');
      if (no) no.textContent = String(e);
    }
  }
}

function versEtatVide(): void {
  items.length = 0;
  principal = null;
  cible = null;
  el.vide.hidden = false;
  el.actif.hidden = true;
  el.coords.value = '';
  el.resultat.hidden = true;
  el.telecharger.disabled = true;
  el.picker.value = '';
  marquerEtape(1);
  annoncer('Aucune photo chargée.');
}

function octets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

const NOM_FORMAT: Record<string, string> = {
  jpeg: 'JPEG', png: 'PNG', webp: 'WebP', heic: 'HEIC', avif: 'AVIF',
  tiff: 'TIFF', gif: 'GIF', video: 'Vidéo', inconnu: 'Inconnu',
};

function afficherPrincipal(): void {
  const it = principal;
  if (!it || !it.read) return;
  const r = it.read;

  el.vide.hidden = true;
  el.actif.hidden = false;
  el.nom.textContent = r.name;
  el.nom.title = r.name;
  el.pillFormat.textContent = `${NOM_FORMAT[r.format] ?? r.format} · ${octets(r.size)}`;

  if (r.position) {
    el.pillPosition.hidden = false;
    el.pillPosition.textContent = `Actuellement : ${formatDecimal(r.position)}`;
  } else {
    el.pillPosition.hidden = true;
  }

  // La phrase est toujours affichée : l'interface annonce la voie AVANT
  // l'action, y compris quand tout est possible. Elle n'est alarmante que
  // lorsqu'une opération manque réellement à l'appel.
  const modifiable = r.can.write;
  el.alerteFormat.hidden = !r.routeReason;
  el.alerteFormat.textContent = r.routeReason;
  el.alerteFormat.classList.toggle('grave', !r.can.read);
  el.alerteFormat.classList.toggle('attention', r.can.read && !(modifiable && r.can.erase));
  el.coords.disabled = !modifiable;
  el.effacer.disabled = !r.can.erase;
  el.effacerTout.disabled = !r.can.eraseAll;

  const infos: Array<[string, string]> = [];
  if (r.camera) infos.push(['Appareil', r.camera]);
  if (r.takenAt) infos.push(['Prise de vue', r.takenAt.replace('T', ' ').replace(/\..*$/, '')]);
  if (r.position) infos.push(['Position', formatDms(r.position)]);
  if (r.altitude !== null) infos.push(['Altitude', `${Math.round(r.altitude)} m`]);
  for (const d of r.details) infos.push([d.label, d.value]);

  el.autres.hidden = infos.length === 0;
  el.autresListe.replaceChildren(
    ...infos.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );

  marquerEtape(r.position || cible ? 2 : 2);
  majResultat();

  const lot = items.length > 1;
  el.lot.hidden = !lot;
  if (lot) majListeLot();

  annoncer(
    r.position
      ? `Photo lue. Position actuelle : ${formatDecimal(r.position)}.`
      : `Photo lue. Aucune position enregistrée dans ce fichier.`,
  );
}

function majListeLot(statuts: Map<string, string> = new Map()): void {
  const modifiables = items.filter((i) => i.read?.can.write).length;
  el.lotResume.textContent = `${items.length} fichiers · ${modifiables} modifiables`;
  el.lotListe.replaceChildren(
    ...items.map((it) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = it.file.name;
      const st = document.createElement('span');
      st.className = 'st';
      const statut = statuts.get(it.id);
      if (statut) {
        st.textContent = statut;
        row.classList.add(statut.startsWith('✓') ? 'ok' : 'ko');
      } else if (it.erreur) {
        st.textContent = 'illisible';
        row.classList.add('ko');
      } else if (it.read?.can.write) {
        st.textContent = it.read.position ? 'position lue' : 'sans position';
      } else if (it.read?.can.erase) {
        // On sait retirer le lieu de ce fichier sans savoir lui en donner un.
        // Le ranger avec les « lecture seule » ferait croire à un refus.
        st.textContent = 'effacement seul';
      } else {
        st.textContent = 'lecture seule';
        row.classList.add('ko');
      }
      row.append(nm, st);
      return row;
    }),
  );
}

function majResultat(): void {
  if (!cible) {
    el.resultat.hidden = true;
    el.telecharger.disabled = true;
    el.telecharger.textContent =
      items.length > 1 ? 'Télécharger les photos' : 'Télécharger la photo';
    return;
  }
  el.resultat.hidden = false;
  el.resultatCoords.textContent = formatDecimal(cible);
  const origine = principal?.read?.position;
  el.resultatDetail.textContent = origine
    ? `à ${formatDistance(distanceMetres(origine, cible))} de la position d'origine`
    : 'nouvelle position pour cette photo';
  const modifiables = items.filter((i) => i.read?.can.write).length;
  el.telecharger.disabled = modifiables === 0;
  el.telecharger.textContent =
    modifiables > 1 ? `Télécharger les ${modifiables} photos` : 'Télécharger la photo';
  marquerEtape(3);
}

/* --- chargement --------------------------------------------------- */

async function charger(fichiers: File[]): Promise<void> {
  const utiles = fichiers.filter((f) => f.size > 0).slice(0, 300);
  if (!utiles.length) return;

  items.length = 0;
  principal = null;
  cible = null;
  el.coords.value = '';

  for (const file of utiles) {
    items.push({ id: `f${++compteur}`, file });
  }

  el.vide.hidden = true;
  el.actif.hidden = false;
  el.nom.textContent = utiles[0].name;
  annoncer(`Lecture de ${utiles.length} fichier${utiles.length > 1 ? 's' : ''}…`);

  for (const it of items) {
    const buffer = await it.file.arrayBuffer();
    const rep = await demander(
      { type: 'read', id: it.id, name: it.file.name, buffer },
      [buffer],
    );
    if (rep.type === 'read:ok') it.read = rep.payload;
    else if (rep.type === 'read:fail') it.erreur = rep.message;
    if (!principal && it.read) {
      principal = it;
      afficherPrincipal();
    }
  }
  if (!principal) {
    principal = items[0];
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent = items[0].erreur ?? "Ce fichier n'a pas pu être lu.";
    annoncer("Ce fichier n'a pas pu être lu.");
    return;
  }
  afficherPrincipal();
}

/* --- application et téléchargement -------------------------------- */

function nomSortie(nom: string, prefixe: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? `${nom.slice(0, point)}${prefixe}${nom.slice(point)}` : `${nom}${prefixe}`;
}

async function appliquer(
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
  prefixe: string,
): Promise<void> {
  // Filtrer sur l'opération RÉELLEMENT demandée, et non sur l'écriture.
  // Auparavant tout passait par `can.write` : sur une photo dont on sait
  // retirer le lieu mais pas en ajouter un, le bouton « Effacer » était actif
  // et ne faisait rien du tout. Un bouton qui n'agit pas est pire qu'un bouton
  // grisé — il laisse croire que le fichier a été traité.
  const permise = (r: PhotoRead): boolean =>
    operation.kind === 'erase' ? r.can.erase
      : operation.kind === 'eraseAll' ? r.can.eraseAll
      : r.can.write;
  const concernes = items.filter((i) => i.read && permise(i.read));
  if (!concernes.length) return;

  el.telecharger.disabled = true;
  el.effacer.disabled = true;
  el.effacerTout.disabled = true;

  const statuts = new Map<string, string>();
  const produits: Array<{ name: string; input: Uint8Array }> = [];
  let echecs = 0;

  for (const [i, it] of concernes.entries()) {
    annoncer(`Traitement ${i + 1} sur ${concernes.length}…`);
    if (concernes.length > 1) majListeLot(statuts);
    const buffer = await it.file.arrayBuffer();
    const rep = await demander(
      { type: 'apply', id: it.id, name: it.file.name, buffer, operation },
      [buffer],
    );
    if (rep.type !== 'apply:done') continue;
    const res: WriteResult = rep.payload;
    if (res.ok) {
      statuts.set(it.id, `✓ ${res.route === 'P1' ? 'sans rien déplacer' : 'écrit'}`);
      produits.push({ name: nomSortie(it.file.name, prefixe), input: res.bytes });
    } else {
      echecs++;
      statuts.set(it.id, res.message.slice(0, 40));
    }
  }

  if (concernes.length > 1) majListeLot(statuts);
  el.effacer.disabled = false;
  el.effacerTout.disabled = false;
  el.telecharger.disabled = false;

  if (!produits.length) {
    el.alerteFormat.hidden = false;
    el.alerteFormat.classList.remove('attention');
    el.alerteFormat.classList.add('grave');
    el.alerteFormat.textContent =
      "Aucun fichier n'a pu être produit. Vos originaux n'ont pas été modifiés.";
    annoncer("Échec : aucun fichier produit. Vos originaux sont intacts.");
    return;
  }

  if (produits.length === 1) {
    telechargerBlob(new Blob([produits[0].input as BlobPart]), produits[0].name);
  } else {
    const zip = await downloadZip(produits).blob();
    telechargerBlob(zip, 'photos-geotager.zip');
  }

  marquerEtape(3);
  annoncer(
    echecs === 0
      ? `${produits.length} fichier${produits.length > 1 ? 's' : ''} prêt${produits.length > 1 ? 's' : ''}, vérifié${produits.length > 1 ? 's' : ''} après écriture.`
      : `${produits.length} fichier(s) prêt(s), ${echecs} en échec. Les originaux concernés sont intacts.`,
  );
}

function telechargerBlob(blob: Blob, nom: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* --- événements --------------------------------------------------- */

el.picker.addEventListener('change', () => {
  if (el.picker.files?.length) void charger(Array.from(el.picker.files));
});

el.changer.addEventListener('click', versEtatVide);

el.coords.addEventListener('input', () => {
  cible = parseCoordinates(el.coords.value);
  majResultat();
});

el.telecharger.addEventListener('click', () => {
  if (!cible) return;
  void appliquer({ kind: 'set', position: cible }, '-geotager');
});

el.effacer.addEventListener('click', () => {
  void appliquer({ kind: 'erase' }, '-sans-position');
});

el.effacerTout.addEventListener('click', () => {
  void appliquer({ kind: 'eraseAll' }, '-sans-metadonnees');
});

// Glisser-déposer sur toute la page.
let profondeur = 0;
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  profondeur++;
  document.body.classList.add('glisse');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', () => {
  profondeur = Math.max(0, profondeur - 1);
  if (profondeur === 0) document.body.classList.remove('glisse');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  profondeur = 0;
  document.body.classList.remove('glisse');
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length) void charger(files);
});

// Collage.
document.addEventListener('paste', (e) => {
  const cibleSaisie = e.target as HTMLElement | null;
  if (cibleSaisie?.tagName === 'INPUT' || cibleSaisie?.tagName === 'TEXTAREA') return;
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length) {
    e.preventDefault();
    void charger(files);
  }
});

versEtatVide();
