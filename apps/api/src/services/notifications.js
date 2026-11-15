import { Router } from 'express';
import { getNotifications, markNotificationRead } from './store.js';

export const notificationsRouter = Router();
notificationsRouter.get('/', (request,response) => response.json({data:getNotifications(request.user.workspaceId,request.user.userId)}));
notificationsRouter.patch('/:id/read', (request,response) => {
  if(!markNotificationRead(request.user.workspaceId,request.user.userId,request.params.id)) return response.status(404).json({error:'Notification not found.'});
  return response.json({data:{id:request.params.id,read:true}});
});
