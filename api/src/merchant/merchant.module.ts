import {Module} from '@nestjs/common';
import {MerchantService} from './merchant.service.js';
import {MerchantController} from './merchant.controller.js';
@Module({controllers:[MerchantController],providers:[MerchantService],exports:[MerchantService]})
export class MerchantModule {}
