package org.trackify.protocol;

import org.junit.jupiter.api.Test;
import org.trackify.ProtocolTest;
import org.trackify.model.Command;

public class PstProtocolEncoderTest extends ProtocolTest {

    @Test
    public void testEncodeEngineStop() throws Exception {

        var encoder = inject(new PstProtocolEncoder(null));

        Command command = new Command();
        command.setDeviceId(1);
        command.setType(Command.TYPE_ENGINE_STOP);

        verifyCommand(encoder, command, binary("860ddf790600000001060002ffffffffe42b"));

    }

    @Test
    public void testEncodeEngineResume() throws Exception {

        var encoder = inject(new PstProtocolEncoder(null));

        Command command = new Command();
        command.setDeviceId(1);
        command.setType(Command.TYPE_ENGINE_RESUME);

        verifyCommand(encoder, command, binary("860ddf790600000001060001ffffffff0af9"));

    }

}
