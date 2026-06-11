require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const app = express();

app.use(cors());

const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let eventsCache = [];

client.once(Events.ClientReady, async () => {
  console.log(`Connecté : ${client.user.tag}`);

  try {
    const guild = client.guilds.cache.get("1447249368783523942");

    if (!guild) {
      console.log("Serveur introuvable");
      return;
    }

    const events = await guild.scheduledEvents.fetch();

    eventsCache = [...events.values()].map(event => ({
      name: event.name,
      description: event.description || "",
      startTime: event.scheduledStartTimestamp
    }));

    console.log("Événements mis à jour :", eventsCache.length);

  } catch (err) {
    console.error(err);
  }
});

app.get("/", (req, res) => {
  res.send("API La communauté live opérationnelle");
});

app.get("/events", (req, res) => {
  res.json(eventsCache);
});

app.listen(PORT, () => {
  console.log(`Serveur web lancé sur le port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
