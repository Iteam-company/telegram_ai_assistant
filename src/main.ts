import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GlobalExceptionsFilter } from './common/filters/global-exceptions.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { TelegramService } from './telegram/telegram.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const telegramService = app.get(TelegramService);

  const httpAdapter = app.get(HttpAdapterHost);

  app.useGlobalFilters(
    new GlobalExceptionsFilter(httpAdapter, telegramService),
  );

  app.useGlobalInterceptors(new TimeoutInterceptor(10000));

  const webhookUrl = `${process.env.HOST}/telegram/webhook`;
  await telegramService.setWebhook(webhookUrl);

  await app.listen(process.env.PORT ?? 8888);
}
bootstrap();
