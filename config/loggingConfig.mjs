import log4js from 'log4js';

export var configureLogging = () => {
  log4js.configure({ appenders: { consoleAppender: { type: 'console' } }, categories: { default: { appenders: ["consoleAppender"], level: "debug" } } });
}
