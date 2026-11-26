# La communauté live — Bot Discord

Version réorganisée à partir de l'archive fournie.

## Installation

1. Installer Node.js 22.13 ou supérieur.
2. Copier `.env.example` vers `.env`.
3. Renseigner les variables privées dans `.env` (ne jamais publier ce fichier).
4. Installer les dépendances avec `npm ci`.
5. Lancer les vérifications avec `npm test`.
6. Démarrer avec `npm start`.

## Structure

- `api/` : serveur HTTP, routes, authentification, permissions et services utilisés par le site.
- `bot/core/` : client Discord, événements Discord et synchronisation des données.
- `config/` : configuration du serveur et permissions par rôle.
- `utils/` : fonctions partagées.
- `test/` : tests automatisés.
- `docs/` : notes d'architecture et périmètre de cette archive.

Consulter `docs/STRUCTURE.md` pour le détail des fonctionnalités conservées et retirées, ainsi que les modules du projet qui n'étaient pas présents dans le ZIP source.
