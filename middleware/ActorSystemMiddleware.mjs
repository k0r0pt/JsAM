export default (app) => {
  app.use(function (req, res, next) {
    var reqDomain = domain.create();
    reqDomain.run(next);            //here your request context is created
  });
}