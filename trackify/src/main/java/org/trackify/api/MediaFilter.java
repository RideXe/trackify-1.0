/*
 * Copyright 2018 - 2025 Anton Tananaev (anton@trackify.org)
 * Copyright 2018 Andrey Kunitsyn (andrey@trackify.org)
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
package org.trackify.api;

import com.google.inject.Provider;
import org.trackify.api.security.PermissionsService;
import org.trackify.database.StatisticsManager;
import org.trackify.helper.SessionHelper;
import org.trackify.model.Device;
import org.trackify.storage.Storage;
import org.trackify.storage.StorageException;
import org.trackify.storage.query.Columns;
import org.trackify.storage.query.Condition;
import org.trackify.storage.query.Request;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;

@Singleton
public class MediaFilter implements Filter {

    private final Storage storage;
    private final StatisticsManager statisticsManager;
    private final Provider<PermissionsService> permissionsServiceProvider;

    @Inject
    public MediaFilter(
            Storage storage, StatisticsManager statisticsManager,
            Provider<PermissionsService> permissionsServiceProvider) {
        this.storage = storage;
        this.statisticsManager = statisticsManager;
        this.permissionsServiceProvider = permissionsServiceProvider;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletResponse httpResponse = (HttpServletResponse) response;
        try {
            Long userId = null;
            if (SessionHelper.isSessionOriginValid((HttpServletRequest) request)) {
                HttpSession session = ((HttpServletRequest) request).getSession(false);
                userId = (Long) session.getAttribute(SessionHelper.USER_ID_KEY);
                if (userId != null) {
                    statisticsManager.registerRequest(userId);
                }
            }
            if (userId == null) {
                httpResponse.sendError(HttpServletResponse.SC_UNAUTHORIZED);
                return;
            }

            String path = ((HttpServletRequest) request).getPathInfo();
            String[] parts = path != null ? path.split("/") : null;
            if (parts != null && parts.length >= 2) {
                Device device = storage.getObject(Device.class, new Request(
                        new Columns.All(), new Condition.Equals("uniqueId", parts[1])));
                if (device != null) {
                    permissionsServiceProvider.get().checkPermission(Device.class, userId, device.getId());
                    chain.doFilter(request, response);
                    return;
                }
            }

            httpResponse.sendError(HttpServletResponse.SC_FORBIDDEN);
        } catch (SecurityException | StorageException e) {
            httpResponse.setStatus(HttpServletResponse.SC_FORBIDDEN);
            e.printStackTrace(httpResponse.getWriter());
        }
    }

}
