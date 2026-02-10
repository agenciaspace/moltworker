# Guia de Deploy - Moltworker

## ✅ Configuração Completada

### Autenticação Cloudflare
- **Status**: ✅ Autenticado
- **Conta**: Leon@agencia.space's Account
- **Account ID**: `925c23de37f51e8268bef2ba980f3d33`
- **API Token**: Configurado

### Token de Gateway Gerado
```
dad831a6b4959a101b51e88642a4f7966643db3f15bd92dc28133402ef0482a8
```

**⚠️ IMPORTANTE**: Salve este token! Você precisará dele para acessar a Control UI após o deploy:
```
https://seu-worker.workers.dev/?token=dad831a6b4959a101b51e88642a4f7966643db3f15bd92dc28133402ef0482a8
```

## 🐳 Limitação Atual: Docker

O deploy local **requer Docker** porque o projeto usa Cloudflare Containers (Sandbox) que precisa buildar a imagem do Dockerfile.

**Problema**: O Docker daemon não pode ser iniciado neste ambiente sandbox devido a restrições de kernel (iptables/nftables não disponíveis).

## 🚀 Soluções para Deploy

### Opção 1: Deploy via GitHub Actions (Recomendado)

Criei um workflow de CI/CD que fará o deploy automaticamente:

1. **Push para o repositório**:
   ```bash
   git push origin claude/deploy-cloudflare-i6sux
   ```

2. **Configure os secrets no GitHub**:
   - Vá para Settings > Secrets and variables > Actions
   - Adicione:
     - `CLOUDFLARE_API_TOKEN`: `QDtYbN4DfRtk3PWqOpB4h8h2d5tPTnmSHFi5Mp8B`
     - `MOLTBOT_GATEWAY_TOKEN`: `dad831a6b4959a101b51e88642a4f7966643db3f15bd92dc28133402ef0482a8`
     - `ANTHROPIC_API_KEY`: Sua chave da Anthropic

3. O GitHub Actions automaticamente fará o build com Docker e deploy!

### Opção 2: Deploy da Sua Máquina Local

Se você tem Docker instalado localmente:

```bash
# Clone o repositório
git clone https://github.com/agenciaspace/moltworker.git
cd moltworker
git checkout claude/deploy-cloudflare-i6sux

# Configure a API token
export CLOUDFLARE_API_TOKEN=QDtYbN4DfRtk3PWqOpB4h8h2d5tPTnmSHFi5Mp8B

# Configure os secrets
echo "dad831a6b4959a101b51e88642a4f7966643db3f15bd92dc28133402ef0482a8" | npx wrangler secret put MOLTBOT_GATEWAY_TOKEN
echo "sua-chave-anthropic" | npx wrangler secret put ANTHROPIC_API_KEY

# Deploy
npm install
npm run deploy
```

### Opção 3: Deploy via Cloudflare Dashboard

Use o botão "Deploy to Cloudflare Workers" do README:
1. Acesse: https://deploy.workers.cloudflare.com/?url=https://github.com/agenciaspace/moltworker
2. Siga as instruções na interface

## 📋 Checklist Pós-Deploy

Após o deploy bem-sucedido:

- [ ] Configure Cloudflare Access para proteger o admin UI `/_admin/`
- [ ] Configure R2 storage para persistência (opcional mas recomendado)
- [ ] Acesse a Control UI com o token de gateway
- [ ] Faça pair dos seus devices via admin UI

## 🔑 Secrets Necessários

| Secret | Status | Valor/Como Obter |
|--------|--------|------------------|
| `CLOUDFLARE_API_TOKEN` | ✅ Configurado | `QDtYbN4DfRtk3PWqOpB4h8h2d5tPTnmSHFi5Mp8B` |
| `MOLTBOT_GATEWAY_TOKEN` | ✅ Gerado | `dad831a6b...` (veja acima) |
| `ANTHROPIC_API_KEY` | ⚠️ Necessário | Obtenha em https://console.anthropic.com/ |
| `CF_ACCESS_TEAM_DOMAIN` | ⏳ Opcional | Configure depois do deploy |
| `CF_ACCESS_AUD` | ⏳ Opcional | Configure depois do deploy |

## 📞 Próximos Passos

1. **Escolha uma das opções de deploy acima**
2. **Configure a chave da Anthropic** (sem ela o OpenClaw não funcionará)
3. **Após o deploy**, configure Cloudflare Access
4. **Configure R2** para persistência de dados

## 🆘 Suporte

- README completo: `README.md`
- Cloudflare Containers Docs: https://developers.cloudflare.com/containers/
- OpenClaw Docs: https://docs.openclaw.ai/
