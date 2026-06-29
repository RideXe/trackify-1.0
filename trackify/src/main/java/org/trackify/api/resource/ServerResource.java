/*
 * Copyright 2015 - 2025 Anton Tananaev (anton@trackify.org)
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

import jakarta.servlet.http.HttpServletRequest;
import jakarta.ws.rs.core.Context;
import org.trackify.api.BaseResource;
import org.trackify.model.ObjectOperation;
import org.trackify.config.Config;
import org.trackify.config.Keys;
import org.trackify.database.OpenIdProvider;
import org.trackify.geocoder.Geocoder;
import org.trackify.helper.Log;
import org.trackify.helper.LogAction;
import org.trackify.helper.model.UserUtil;
import org.trackify.mail.MailManager;
import org.trackify.model.Server;
import org.trackify.model.User;
import org.trackify.session.cache.CacheManager;
import org.trackify.sms.SmsManager;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import jakarta.annotation.Nullable;
import jakarta.annotation.security.PermitAll;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Collection;
import java.util.List;
import java.util.TimeZone;

@Path("server")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ServerResource extends BaseResource {

    @Inject
    private Config config;

    @Inject
    private CacheManager cacheManager;

    @Inject
    private MailManager mailManager;

    @Inject
    @Nullable
    private SmsManager smsManager;

    @Inject
    @Nullable
    private OpenIdProvider openIdProvider;

    @Inject
    @Nullable
    private Geocoder geocoder;

    @Inject
    private LogAction actionLogger;

    @Context
    private HttpServletRequest request;

    @PermitAll
    @GET
    public Server get() throws StorageException {
        Server server = storage.getObject(Server.class, new Request(new Columns.All()));
        server.setEmailEnabled(mailManager.getEmailEnabled());
        server.setTextEnabled(smsManager != null);
        server.setGeocoderEnabled(geocoder != null);
        server.setOpenIdEnabled(openIdProvider != null);
        server.setOpenIdForce(openIdProvider != null && openIdProvider.getForce());
        User user = permissionsService.getUser(getUserId());
        if (user != null) {
            if (user.getAdministrator()) {
                server.setStorageSpace(Log.getStorageSpace());
            }
        } else {
            server.setNewServer(UserUtil.isEmpty(storage));
        }
        return server;
    }

    @PUT
    public Response update(Server server) throws Exception {
        permissionsService.checkAdmin(getUserId());
        storage.updateObject(server, new Request(
                new Columns.Exclude("id"),
                new Condition.Equals("id", server.getId())));
        cacheManager.invalidateObject(true, Server.class, server.getId(), ObjectOperation.UPDATE);
        actionLogger.edit(request, getUserId(), server);
        return Response.ok(server).build();
    }

    @Path("geocode")
    @GET
    public String geocode(@QueryParam("latitude") double latitude, @QueryParam("longitude") double longitude) {
        if (geocoder != null) {
            return geocoder.getAddress(latitude, longitude, null);
        } else {
            throw new RuntimeException("Reverse geocoding is not enabled");
        }
    }

    @Path("timezones")
    @GET
    public Collection<String> timezones() {
        return List.of(TimeZone.getAvailableIDs());
    }

    @Path("file/{path}")
    @POST
    @Consumes("*/*")
    public Response uploadFile(@PathParam("path") String path, File inputFile) throws IOException, StorageException {
        permissionsService.checkAdmin(getUserId());
        String root = config.getString(Keys.WEB_OVERRIDE, config.getString(Keys.WEB_PATH));

        var rootPath = Paths.get(root).normalize();
        var outputPath = rootPath.resolve(path).normalize();
        if (!outputPath.startsWith(rootPath)) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }

        var directoryPath = outputPath.getParent();
        if (directoryPath != null) {
            Files.createDirectories(directoryPath);
        }

        try (var input = new FileInputStream(inputFile); var output = new FileOutputStream(outputPath.toFile())) {
            input.transferTo(output);
        }
        return Response.ok().build();
    }

    @Path("gc")
    @GET
    public Response gc() throws StorageException {
        permissionsService.checkAdmin(getUserId());
        System.gc();
        return Response.ok().build();
    }

    @Path("cache")
    @GET
    public String cache() throws StorageException {
        permissionsService.checkAdmin(getUserId());
        return cacheManager.toString();
    }

    @Path("reboot")
    @POST
    public void reboot() throws StorageException {
        permissionsService.checkAdmin(getUserId());
        System.exit(130);
    }

}
