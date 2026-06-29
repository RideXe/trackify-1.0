/*
 * Copyright 2015 - 2021 Anton Tananaev (anton@trackify.org)
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
package org.trackify.protocol;

import io.netty.handler.codec.string.StringEncoder;
import org.trackify.BaseProtocol;
import org.trackify.PipelineBuilder;
import org.trackify.TrackerServer;
import org.trackify.config.Config;
import org.trackify.model.Command;

import jakarta.inject.Inject;

public class AdmProtocol extends BaseProtocol {

    @Inject
    public AdmProtocol(Config config) {
        setSupportedDataCommands(
                Command.TYPE_GET_DEVICE_STATUS,
                Command.TYPE_CUSTOM);
        addServer(new TrackerServer(config, getName(), false) {
            @Override
            protected void addProtocolHandlers(PipelineBuilder pipeline, Config config) {
                pipeline.addLast(new AdmFrameDecoder());
                pipeline.addLast(new StringEncoder());
                pipeline.addLast(new AdmProtocolEncoder(AdmProtocol.this));
                pipeline.addLast(new AdmProtocolDecoder(AdmProtocol.this));
            }
        });
    }

}
