const app = require('./');

app.Navigation('navAPI')
  .route({url: '/api',route: 'api', text: 'API'});

// app.Navigation('navTerms')
//   .route({url: '/privacy',route: 'home', text: 'Privacy'})
//   .route({url: '/terms',route: 'home', text: 'Terms'});

app.Navigation('navPage')
  .route({url: '/',route: 'home', text: 'Home'})
  // .route({url: '/about',route: 'about', text: 'About'})
  // .route({url: '/music',route: 'music', text: 'Music'});

app.Navigation('navFallback')
  .route({url: '*',route: 'home', text: 'Fallback'})
