function createSiteDataService() {
    let eventsCache = [];
    let staffCache = [];
    let statsCache = {};
    let announcementsCache = [];
    let rulesCache = { content: "" };

    return {
        getEvents: () => eventsCache,
        setEvents: value => { eventsCache = value; },
        getStaff: () => staffCache,
        setStaff: value => { staffCache = value; },
        getStats: () => statsCache,
        setStats: value => { statsCache = value; },
        getAnnouncements: () => announcementsCache,
        setAnnouncements: value => { announcementsCache = value; },
        getRules: () => rulesCache,
        setRules: value => { rulesCache = value; }
    };
}

module.exports = { createSiteDataService };
