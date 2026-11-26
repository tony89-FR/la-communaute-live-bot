# Structure du projet

Cette archive est une remise en ordre du code présent dans le ZIP fourni. Elle conserve les fonctions déjà présentes et ne prétend pas ajouter les modules qui ne figuraient pas dans cette archive.

```text
.
├── api/
│   ├── app.js
│   ├── middleware/
│   ├── routes/
│   └── services/
├── bot/
│   └── core/
│       ├── client.js
│       ├── handlers/
│       └── services/
├── config/
├── docs/
├── test/
├── utils/
├── index.js
├── package.json
└── .env.example
```

## Retiré pour supprimer l'envoi depuis le site

- Les routes `/chat/*` et leur fichier de routes : lecture et envoi de messages du serveur Discord depuis le site.
- La route `/creation/announcement`, les suggestions de mentions associées et le service qui publiait une annonce avec `channel.send()`.
- Les permissions de site `discord_mobile` et `create_announcement`, devenues inutiles dans ce périmètre.
- Les intents Discord `GuildMessages` et `MessageContent`, qui n'étaient plus nécessaires à ces fonctionnalités.
- Un ancien fichier de routes de création non utilisé.

La route `/creation/event` est conservée : elle crée un événement Discord, pas un message. La lecture des annonces existantes sur le site reste conservée.

## Modules prévus mais absents du ZIP source

Le ZIP fourni ne contenait pas de dossiers `database/`, `bot/xp-economie/`, `bot/evenements/` ni les modules d'économie, de missions, de boutique, d'inventaire, de sauvegardes et de tableau de bord décrits dans le projet. Ils ne sont pas fabriqués artificiellement dans cette remise en ordre. Il faudra repartir de leurs fichiers réels pour les réintégrer.
