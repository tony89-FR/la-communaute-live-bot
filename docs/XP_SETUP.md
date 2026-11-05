# Première étape : base de données et attribution d'XP

## Runtime requis

Le projet utilise le module SQLite intégré à Node.js (`node:sqlite`). Il faut Node.js 22.13.0 ou plus récent. Aucun paquet SQLite externe ni compilation native n'est nécessaire.

## Stockage

Sur Deplexo, le chemin par défaut est `/data/la-communaute-live.sqlite` si le volume `/data` existe. Il est aussi possible de définir `DATABASE_PATH=/data/la-communaute-live.sqlite` dans les variables d'environnement de l'application.

En développement local, le projet utilise `./data/la-communaute-live.sqlite` si `/data` n'existe pas.

Ne place pas la base SQLite dans le dossier du code en production : le volume `/data` est l'emplacement persistant prévu pour ce type de fichier.

## XP actuellement actif

- Message valide : 20 XP si le dernier message valide date d'au moins 30 secondes, sinon 15 XP.
- Le délai est réinitialisé après chaque message valide.
- Les messages de bots et les messages vides ne donnent pas d'XP.
- Un message composé d'une pièce jointe, d'un sticker ou d'un embed est traité comme non vide.
- Vocal : 10 XP par minute complète passée en vocal.
- Le micro coupé et le salon AFK ne bloquent pas l'XP vocal.
- Les bots ne gagnent pas d'XP.
- Les boosts XP actifs sont déjà pris en compte par le moteur de calcul, même si les commandes et la boutique de boosts seront développées plus tard.

Les minutes vocales partielles ne sont pas créditées. Après un redémarrage du bot, le suivi des membres déjà présents en vocal recommence à partir du redémarrage : aucune XP n'est accordée pour la période où le bot ne suivait pas la session.

## Progression des niveaux

Le seuil cumulé du niveau `n` est `25 × (n - 1) × (n + 2)`. Cela reproduit les seuils validés : niveau 2 = 100 XP, niveau 3 = 250 XP, niveau 4 = 450 XP, niveau 5 = 700 XP, niveau 6 = 1 000 XP et niveau 7 = 1 350 XP. Il n'y a pas de plafond.

## Annonces de niveau

Pour cette première étape, le salon peut être indiqué temporairement par la variable `LEVEL_UP_CHANNEL_ID`. Le réglage depuis le panneau d'administration du site sera raccordé dans une étape ultérieure. Sans cette variable, l'XP fonctionne mais aucune annonce de niveau n'est publiée.

## Tests

Lancer `npm test`. Les tests couvrent les seuils, le délai des messages, les messages invalides et le multiplicateur de boost.
