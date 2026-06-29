/*
 * Copyright 2026 Anton Tananaev (anton@trackify.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.trackify.api.resource;

import io.netty.buffer.ByteBuf;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;
import org.trackify.api.BaseResource;
import org.trackify.media.VideoStreamManager;
import org.trackify.model.Device;
import org.trackify.storage.StorageException;

@Path("stream")
public class VideoStreamResource extends BaseResource {

    @Inject
    private VideoStreamManager streamManager;

    @GET
    @Path("{deviceId}/{channel}/live.m3u8")
    public Response playlist(
            @PathParam("deviceId") long deviceId,
            @PathParam("channel") int channel) throws StorageException {

        permissionsService.checkPermission(Device.class, getUserId(), deviceId);
        return Response.ok(streamManager.getPlaylist(deviceId, channel), "application/vnd.apple.mpegurl").build();
    }

    @GET
    @Path("{deviceId}/{channel}/{index}.ts")
    public Response segment(
            @PathParam("deviceId") long deviceId,
            @PathParam("channel") int channel,
            @PathParam("index") int index) throws StorageException {

        permissionsService.checkPermission(Device.class, getUserId(), deviceId);
        ByteBuf data = streamManager.getSegment(deviceId, channel, index);
        StreamingOutput stream = output -> data.getBytes(data.readerIndex(), output, data.readableBytes());
        return Response.ok(stream, "video/mp2t").build();
    }

}
