import LANDING from "./landing.js";
import APP_HTML from "./app-html.js";
import APP_JS from "./app-js.js";
import APP_CSS from "./app-css.js";
import MEMBERS from "./members.js";

const NICHE_TO_OSM = {
  dentist: '["amenity"="dentist"]',
  clinic: '["amenity"="clinic"]',
  lawyer: '["office"="lawyer"]',
  architect: '["office"="architect"]',
  accountant: '["office"="accountant"]',
  physiotherapy: '["healthcare"="physiotherapist"]',
  salon: '["shop"="hairdresser"]',
  gym: '["leisure"="fitness_centre"]',
  restaurant: '["amenity"="restaurant"]',
  real_estate: '["office"="estate_agent"]'
};

const NICHE_LABELS = {
  dentist: 'dentista', clinic: 'clínica', lawyer: 'advogado', architect: 'arquiteto',
  accountant: 'contador', physiotherapy: 'fisioterapia', salon: 'salão de beleza',
  gym: 'academia', restaurant: 'restaurante', real_estate: 'imobiliária'
};

const GENERIC_NAMES = new Set([
  'empresa local','empresa','local business','business','dentista','clínica','clinica','advogado','arquiteto',
  'contador','fisioterapia','salão de beleza','salao de beleza','academia','restaurante','imobiliária','imobiliaria'
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function text(body, type='text/html; charset=utf-8') { return new Response(body, { headers: { 'content-type': type } }); }
function cleanPhone(phone = '') { return phone.replace(/[^\d+]/g, ''); }
function cleanName(value = '') {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 2 || GENERIC_NAMES.has(name.toLowerCase())) return '';
  return name;
}

function mapGooglePlace(p) {
  const name = cleanName(p.displayName?.text);
  return {
    id: p.id, source: 'google', name, address: p.formattedAddress || '',
    lat: p.location?.latitude, lng: p.location?.longitude,
    phone: cleanPhone(p.nationalPhoneNumber || p.internationalPhoneNumber || ''),
    website: p.websiteUri || '', mapsUrl: p.googleMapsUri || '', rating: p.rating || null,
    reviews: p.userRatingCount || 0, type: p.primaryType || (p.types || [])[0] || '', instagram: '', status: 'new'
  };
}

async function googleSearch({ city, niche }, env) {
  if (!env.GOOGLE_PLACES_API_KEY) return null;
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.primaryType,places.types'
    },
    body: JSON.stringify({ textQuery: `${NICHE_LABELS[niche] || niche} em ${city}`, languageCode: 'pt-BR', regionCode: 'BR' })
  });
  if (!r.ok) return null;
  const data = await r.json();
  return (data.places || []).map(mapGooglePlace).filter(p => p.name && !p.website && p.lat && p.lng);
}

async function nominatim(params) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'User-Agent': 'site-sales-os/0.5', 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!r.ok) throw new Error(`Nominatim indisponível (${r.status})`);
  return r.json();
}

async function geocodeCity(city) {
  const rows = await nominatim({ q: `${city}, Brasil`, format: 'jsonv2', limit: 1 });
  if (!rows[0]) throw new Error('Cidade não encontrada.');
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}

function nominatimName(p) {
  const n = p.namedetails || {};
  const x = p.extratags || {};
  const displayFirst = String(p.display_name || '').split(',')[0];
  return cleanName(n.name) || cleanName(n['name:pt']) || cleanName(p.name) || cleanName(x.brand) || cleanName(x.operator) || cleanName(x.official_name) || cleanName(x.short_name) || cleanName(displayFirst) || '';
}

function mapNominatimPlace(p) {
  const x = p.extratags || {};
  const lat = Number(p.lat), lng = Number(p.lon);
  const name = nominatimName(p);
  return {
    id: `nominatim-${p.osm_type || 'place'}-${p.osm_id || p.place_id}`,
    source: 'nominatim', name, address: p.display_name || '', lat, lng,
    phone: cleanPhone(x.phone || x['contact:phone'] || ''),
    website: x.website || x['contact:website'] || '',
    mapsUrl: Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : '',
    rating: null, reviews: 0, type: p.type || p.category || '', instagram: x.instagram || x['contact:instagram'] || '', status: 'new'
  };
}

async function fallbackLeadsHandler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { city = 'São Paulo', niche = 'dentist' } = await request.json();
    const term = NICHE_LABELS[niche] || niche;
    const rows = await nominatim({
      q: `${term}, ${city}, Brasil`, format: 'jsonv2', limit: 35,
      addressdetails: 1, extratags: 1, namedetails: 1, dedupe: 1
    });
    const leads = (rows || []).map(mapNominatimPlace).filter(p => p.name && p.lat && p.lng && !p.website).slice(0, 35);
    return json({ city, niche, provider: 'nominatim-fallback', count: leads.length, leads });
  } catch (error) {
    return json({ error: error.message || 'Fallback indisponível' }, 500);
  }
}

async function leadsHandler(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { city = 'São Paulo', niche = 'dentist', radius = 7000 } = await request.json();
    const google = await googleSearch({ city, niche }, env);
    if (google) return json({ city, niche, provider: 'google', center: null, count: google.length, leads: google });

    const center = await geocodeCity(city);
    const filter = NICHE_TO_OSM[niche] || '["name"]';
    const cappedRadius = Math.min(Math.max(Number(radius) || 7000, 1000), 20000);
    const overpassQuery = `[out:json][timeout:15];(nwr${filter}(around:${cappedRadius},${center.lat},${center.lng}););out center tags 80;`;
    return json({ city, niche, provider: 'openstreetmap-browser', center, overpassQuery, count: 0, leads: [] });
  } catch (error) {
    return json({ error: error.message || 'Erro na busca' }, 500);
  }
}

function fallback({ lead, goal, notes }) {
  const name = lead?.name || 'sua empresa';
  if (goal === 'followup') return `Oi! Passando só para retomar a mensagem sobre o site da ${name}. Posso montar uma prévia objetiva e você avalia sem compromisso.`;
  if (goal === 'objection-price') return `Entendo. Podemos começar com uma versão enxuta para a ${name}, focada em apresentação, confiança e contato por WhatsApp. Posso te passar o escopo mínimo e o valor.`;
  if (goal === 'proposal') return `Proposta — ${name}\n\nInclui página responsiva, apresentação do negócio, serviços, localização, WhatsApp, SEO básico e publicação.\n\nPrazo sugerido: 3 a 5 dias úteis após receber os materiais.`;
  return `Oi! Encontrei a ${name} pesquisando negócios da região e vi uma oportunidade de melhorar a presença online. Posso montar uma prévia do site antes de qualquer compromisso. Se eu te mandar uma ideia inicial, você consegue dar uma olhada?${notes ? `\n\nContexto: ${notes}` : ''}`;
}

async function prospectHandler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { lead = {}, goal = 'first-contact', notes = '' } = await request.json();
  return json({ provider: 'template', text: fallback({ lead, goal, notes }) });
}

export default {
  async fetch(request, env) {
    const p = new URL(request.url).pathname;
    if (p === '/api/health') return json({ ok: true, service: 'site-sales-os', version: 5 });
    if (p === '/api/leads') return leadsHandler(request, env);
    if (p === '/api/fallback-leads') return fallbackLeadsHandler(request);
    if (p === '/api/prospect') return prospectHandler(request, env);
    if (p === '/app/app.js') return text(APP_JS, 'application/javascript; charset=utf-8');
    if (p === '/app/styles.css') return text(APP_CSS, 'text/css; charset=utf-8');
    if (p === '/app' || p === '/app/') return text(APP_HTML);
    if (p === '/members' || p === '/members/') return text(MEMBERS);
    if (p === '/' || p === '/index.html') return text(LANDING);
    return new Response('Not found', { status: 404 });
  }
};
