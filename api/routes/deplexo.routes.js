const DEPLEXO_API_BASE = "https://deplexo.com/user/api/v1";

module.exports = function registerDeplexoRoutes(app) {
    let cache = null;
    let cacheAt = 0;
    let pendingRequest = null;
    const CACHE_MS = 20_000;

    function readAppShape(payload) {
        const value = payload?.data ?? payload?.app ?? payload ?? {};
        return {
            name: value.name ?? value.appName ?? value.app_name ?? null,
            status: value.status ?? value.state ?? value.currentStatus ?? value.current_status ?? null,
            createdAt: value.createdAt ?? value.created_at ?? null
        };
    }

    function readDeploymentShape(payload) {
        const root = payload?.data ?? payload ?? {};
        const items = Array.isArray(root) ? root : (root.deployments ?? root.items ?? root.results ?? []);
        const total = root.pagination?.total ?? root.total ?? root.count ?? payload?.pagination?.total ?? (Array.isArray(items) ? items.length : null);
        const latest = Array.isArray(items) ? items[0] : null;
        return {
            total: Number.isFinite(Number(total)) ? Number(total) : null,
            latest: latest ? {
                status: latest.status ?? latest.state ?? null,
                createdAt: latest.createdAt ?? latest.created_at ?? latest.startedAt ?? latest.started_at ?? null,
                finishedAt: latest.finishedAt ?? latest.finished_at ?? null,
                commitSha: latest.commitSha ?? latest.commit_sha ?? latest.commit ?? null
            } : null
        };
    }

    async function deplexoGet(path, token) {
        const response = await fetch(`${DEPLEXO_API_BASE}${path}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            signal: AbortSignal.timeout(8000)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(`Deplexo API a répondu HTTP ${response.status}.`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    app.get("/deplexo/metrics", async (_req, res) => {
        const token = process.env.DEPLEXO_TOKEN;
        const appId = process.env.DEPLEXO_APP_ID;

        if (!token || !appId) {
            return res.status(503).json({
                ok: false,
                code: "CONFIG_REQUIRED",
                message: "Les métriques Deplexo ne sont pas configurées. Ajoute DEPLEXO_TOKEN et DEPLEXO_APP_ID dans les variables d’environnement du service."
            });
        }

        if (cache && Date.now() - cacheAt < CACHE_MS) {
            return res.json(cache);
        }
        if (pendingRequest) {
            try { return res.json(await pendingRequest); }
            catch { /* la requête ci-dessous renverra une erreur contrôlée */ }
        }

        pendingRequest = (async () => {
            const encodedId = encodeURIComponent(appId);
            const [statsPayload, appPayload, deploymentsPayload] = await Promise.all([
                deplexoGet(`/apps/${encodedId}/live-stats`, token),
                deplexoGet(`/apps/${encodedId}`, token),
                deplexoGet(`/apps/${encodedId}/deployments?limit=1&offset=0`, token).catch(error => ({ unavailable: true, status: error.status || null }))
            ]);
            const result = {
                ok: true,
                checkedAt: new Date().toISOString(),
                app: readAppShape(appPayload),
                liveStats: statsPayload?.data ?? statsPayload,
                deployments: deploymentsPayload?.unavailable ? null : readDeploymentShape(deploymentsPayload)
            };
            cache = result;
            cacheAt = Date.now();
            return result;
        })();

        try {
            return res.json(await pendingRequest);
        } catch (error) {
            const status = error.status === 401 || error.status === 403 ? 503 : 502;
            console.warn("Impossible de récupérer les métriques Deplexo :", error.message);
            return res.status(status).json({
                ok: false,
                code: error.status === 401 || error.status === 403 ? "DEPLEXO_AUTH_FAILED" : "DEPLEXO_UNAVAILABLE",
                message: error.status === 401 || error.status === 403
                    ? "La clé Deplexo est invalide ou ne possède pas la permission app:read."
                    : "Impossible de charger les métriques Deplexo pour le moment. Vérifie la clé, l’identifiant de l’application et la disponibilité de Deplexo."
            });
        } finally {
            pendingRequest = null;
        }
    });
};
