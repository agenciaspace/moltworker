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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cleanPhone(phone = '') {
  return phone.replace(/[^\d+]/g, '');
}

function mapGooglePlace(p) {
  return {
    id: p.id,
    source: 'google',
    name: p.displayName?.text || 'Empresa',
    address: p.formattedAddress || '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: cleanPhone(p.nationalPhoneNumber || p.internationalPhoneNumber || ''),
    website: p.websiteUri || '',
    mapsUrl: p.googleMapsUri || '',
    rating: p.rating || null,
    reviews: p.userRatingCount || 0,
    type: p.primaryType || (p.types || [])[0] || '',
    instagram: '',
    status: 'new'
  };
}

async function googleSearch({ city, niche }, env) {
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const textQuery = `${NICHE_LABELS[niche] || niche} em ${city}`;
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': [
        'places.id','places.displayName','places.formattedAddress','places.location',
        'places.nationalPhoneNumber','places.internationalPhoneNumber','places.websiteUri',
        'places.googleMapsUri','places.rating','places.userRatingCount','places.primaryType','places.types'
      ].join(',')
    },
    body: JSON.stringify({ textQuery, languageCode: 'pt-BR', regionCode: 'BR' })
  });
  if (!response.ok) throw new Error(`Google Places: ${response.status}`);
  const data = await response.json();
  return (data.places || []).map(mapGooglePlace).filter(p => !p.website && p.lat && p.lng);
}

async function geocodeCity(city) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${city}, Brasil`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const r = await fetch(url, { headers: { 'User-Agent': 'site-sales-os/0.1 (lead discovery prototype)' } });
  if (!r.ok) throw new Error('Não foi possível localizar a cidade.');
  const rows = await r.json();
  if (!rows[0]) throw new Error('Cidade não encontrada.');
  return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
}

function overpassElementToLead(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const address = [t['addr:street'], t['addr:housenumber'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ');
  return {
    id: `osm-${el.type}-${el.id}`,
    source: 'osm',
    name: t.name || t.brand || 'Empresa local',
    address,
    lat,
    lng,
    phone: cleanPhone(t.phone || t['contact:phone'] || ''),
    website: t.website || t['contact:website'] || '',
    mapsUrl: lat && lng ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : '',
    rating: null,
    reviews: 0,
    type: t.amenity || t.office || t.shop || t.healthcare || t.leisure || '',
    instagram: t.instagram || t['contact:instagram'] || '',
    status: 'new'
  };
}

async function osmSearch({ city, niche, radius = 7000 }) {
  const center = await geocodeCity(city);
  const filter = NICHE_TO_OSM[niche] || '["name"]';
  const cappedRadius = Math.min(Math.max(Number(radius) || 7000, 1000), 20000);
  const q = `[out:json][timeout:25];(nwr(around:${cappedRadius},${center.lat},${center.lng})${filter};);out center tags 80;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: q })
  });
  if (!r.ok) throw new Error('Falha temporária na busca OpenStreetMap.');
  const data = await r.json();
  const leads = (data.elements || []).map(overpassElementToLead).filter(p => p.name && p.lat && p.lng && !p.website);
  return { center, leads: leads.slice(0, 80) };
}

async function leadsHandler(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { city = 'São Paulo', niche = 'dentist', radius = 7000 } = await request.json();
    let leads = await googleSearch({ city, niche }, env);
    let center = null;
    let provider = 'google';
    if (!leads) {
      const osm = await osmSearch({ city, niche, radius });
      leads = osm.leads;
      center = osm.center;
      provider = 'openstreetmap';
    }
    return json({ city, niche, provider, center, count: leads.length, leads });
  } catch (error) {
    return json({ error: error.message || 'Erro na busca' }, 500);
  }
}

function fallback({ lead, goal, notes }) {
  const first = lead?.name || 'sua empresa';
  const city = (lead?.address || '').split(',').slice(-2).join(',').trim();
  if (goal === 'followup') return `Oi! Passando só para retomar a mensagem sobre o site da ${first}. A ideia é simples: eu monto uma prévia objetiva, já pensando em celular e contato por WhatsApp, e você avalia sem compromisso. Se fizer sentido, te envio a primeira versão.`;
  if (goal === 'objection-price') return `Entendo. Em vez de começar com algo grande, dá para fazer uma primeira versão enxuta focada em apresentar a ${first}, gerar confiança e facilitar contato. Posso te mostrar o escopo mínimo e o valor antes de qualquer decisão.`;
  if (goal === 'proposal') return `Proposta — ${first}\n\nObjetivo: colocar no ar uma presença profissional, rápida e clara, pensada para converter visitas em contatos.\n\nInclui: página responsiva, apresentação do negócio, serviços, localização, botão de WhatsApp, SEO básico e publicação.\n\nPrazo sugerido: 3 a 5 dias úteis após receber materiais.\n\nPróximo passo: validar conteúdo e identidade visual para eu montar a primeira versão.`;
  return `Oi! Encontrei a ${first}${city ? ` na região de ${city}` : ''} e vi uma oportunidade simples de melhorar a presença online. Eu crio sites rápidos para negócios locais e posso montar uma prévia da página de vocês antes de qualquer compromisso. Se eu te mandar uma ideia inicial, você consegue dar uma olhada?${notes ? `\n\nContexto usado: ${notes}` : ''}`;
}

function extractText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  for (const item of data.output || []) for (const c of item.content || []) if (c.type === 'output_text' && c.text) return c.text;
  return '';
}

async function prospectHandler(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { lead = {}, goal = 'first-contact', notes = '' } = await request.json();
  if (!env.OPENAI_API_KEY) return json({ provider: 'template', text: fallback({ lead, goal, notes }) });
  const system = 'Você é um copiloto de prospecção B2B para criação de sites de pequenos negócios no Brasil. Gere mensagens curtas, naturais, específicas e sem promessas de resultado. Nunca invente fatos sobre o lead. Priorize mostrar uma prévia concreta em vez de pressão comercial.';
  const input = `Objetivo: ${goal}\nLead: ${JSON.stringify(lead)}\nNotas do usuário: ${notes || 'nenhuma'}\nGere somente o texto final em português do Brasil.`;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-5.6', instructions: system, input, store: false })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const data = await r.json();
    return json({ provider: 'openai', text: extractText(data) || fallback({ lead, goal, notes }) });
  } catch (error) {
    return json({ provider: 'template-fallback', warning: error.message, text: fallback({ lead, goal, notes }) });
  }
}

function text(body,type='text/html; charset=utf-8'){return new Response(body,{headers:{'content-type':type}})}
export default {async fetch(request,env){
 const p=new URL(request.url).pathname;
 if(p==='/api/health')return json({ok:true,service:'site-sales-os'});
 if(p==='/api/leads')return leadsHandler(request,env);
 if(p==='/api/prospect')return prospectHandler(request,env);
 if(p==='/app/app.js')return text(APP_JS,'application/javascript; charset=utf-8');
 if(p==='/app/styles.css')return text(APP_CSS,'text/css; charset=utf-8');
 if(p==='/app'||p==='/app/')return text(APP_HTML);
 if(p==='/members'||p==='/members/')return text(MEMBERS);
 if(p==='/'||p==='/index.html')return text(LANDING);
 return new Response('Not found',{status:404,headers:{'content-type':'text/plain; charset=utf-8'}});
}};
