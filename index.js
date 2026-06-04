require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async () => {

  console.log(`Connecté : ${client.user.tag}`);

  const guild = client.guilds.cache.get("1447249368783523942");

  if (!guild) {
    console.log("Serveur introuvable");
    return;
  }

  const events = await guild.scheduledEvents.fetch();

  console.log("Événements trouvés :");

  events.forEach(event => {
    console.log(event.name);
  });

});

client.login(process.env.DISCORD_TOKEN);
