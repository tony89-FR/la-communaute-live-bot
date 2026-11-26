module.exports = function registerPublicRoutes(app, context) {
    const { siteData } = context;

    app.get("/", (req, res) => {
        res.send("API La communauté live opérationnelle 🚀");
    });

    app.get("/stats", (req, res) => res.json(siteData.getStats()));
    app.get("/events", (req, res) => res.json(siteData.getEvents()));
    app.get("/staff", (req, res) => res.json(siteData.getStaff()));
    app.get("/annonces", (req, res) => res.json(siteData.getAnnouncements()));
    app.get("/regles", (req, res) => res.json(siteData.getRules()));
};
