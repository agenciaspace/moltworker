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

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}
function text(body, type='text/html; charset=utf-8') { return new Response(body, { headers: { 'content-type': type } }); }
function cleanPhone(phone = '') { return phone.replace(/[^\d+]/g, ''); }

function mapGooglePlace(p) {
  return {
    id: p.id, source: 'google', name: p.displayName?.text || 'Empresa', address: p.formattedAddress || '',
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
  return (data.places || []).map(mapGooglePlace).filter(p => !p.website && p.lat && p.lng);
}

async function geocodeCity(city) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${city}, Brasil`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const r = await fetch(url, { headers: { 'User-Agent': 'site-sales-os/0.2', 'Accept-Language': 'pt-BR,pt;q=0.9' } });
  if (!r.ok) throw new Error(`Geocoding indisponível (${r.status})`);
  const rows = await r.json();
  if (!rows[0]) throw new Error('Cidade não encontrada.');
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}

function overpassElementToLead(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  return {
    id: `osm-${el.type}-${el.id}`, source: 'osm', name: t.name || t.brand || 'Empresa local',
    address: [t['addr:street'], t['addr:housenumber'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', '),
    lat, lng, phone: cleanPhone(t.phone || t['contact:phone'] || ''), website: t.website || t['contact:website'] || '',
    mapsUrl: lat && lng ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : '',
    rating: null, reviews: 0, type: t.amenity || t.office || t.shop || t.healthcare || t.leisure || '',
    instagram: t.instagram || t['contact:instagram'] || '', status: 'new'
  };
}

async function queryOverpass(q) {
  const errors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const r = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Accept': 'application/json' },
        body: new URLSearchParams({ data: q })
      });
      clearTimeout(timer);
      if (!r.ok) { errors.push(`${new URL(endpoint).host}:${r.status}`); continue; }
      const data = await r.json();
      return { data, endpoint: new URL(endpoint).host };
    } catch (e) {
      errors.push(`${new URL(endpoint).host}:${e.name || 'error'}`);
    }
  }
  throw new Error(`Busca OpenStreetMap indisponível (${errors.join(', ')})`);
}

async function osmSearch({ city, niche, radius = 7000 }) {
  const center = await geocodeCity(city);
  const filter = NICHE_TO_OSM[niche] || '["name"]';
  const cappedRadius = Math.min(Math.max(Number(radius) || 7000, 1000), 20000);
  const q = `[out:json][timeout:12];(nwr${filter}(around:${cappedRadius},${center.lat},${center.lng}););out center tags 80;`;
  const { data, endpoint } = await queryOverpass(q);
  const leads = (data.elements || []).map(overpassElementToLead).filter(p => p.name && p.lat && p.lng && !p.website).slice(0, 80);
  return { center, leads, endpoint };
}

async function leadsHandler(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { city = 'São Paulo', niche = 'dentist', radius = 7000 } = await request.json();
    const google = await googleSearch({ city, niche }, env);
    if (google) return json({ city, niche, provider: 'google', center: null, count: google.length, leads: google });
    const osm = await osmSearch({ city, niche, radius });
    return json({ city, niche, provider: `openstreetmap:${osm.endpoint}`, center: osm.center, count: osm.leads.length, leads: osm.leads });
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

async function prospectHandler(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { lead = {}, goal = 'first-contact', notes = '' } = await request.json();
  return json({ provider: 'template', text: fallback({ lead, goal, notes }) });
}

export default {
  async fetch(request, env) {
    const p = new URL(request.url).pathname;
    if (p === '/api/health') return json({ ok: true, service: 'site-sales-os', version: 2 });
    if (p === '/api/leads') return leadsHandler(request, env);
    if (p === '/api/prospect') return prospectHandler(request, env);
    if (p === '/app/app.js') return text(APP_JS, 'application/javascript; charset=utf-8');
    if (p === '/app/styles.css') return text(APP_CSS, 'text/css; charset=utf-8');
    if (p === '/app' || p === '/app/') return text(APP_HTML);
    if (p === '/members' || p === '/members/') return text(MEMBERS);
    if (p === '/' || p === '/index.html') return text(LANDING);
    return new Response('Not found', { status: 404 });
  }
};
